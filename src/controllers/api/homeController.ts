import type { Request, Response } from "express";

function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) return xf.split(",")[0]!.trim();
  if (Array.isArray(xf) && xf[0]) return xf[0].trim();
  return req.socket?.remoteAddress ?? "";
}
import bcrypt from "bcryptjs";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { prisma } from "../../shared/db.js";
import { cashfreeCreatePgOrder, normalizeIndianMobile10 } from "../../shared/cashfreePg.js";
import {
  createDigilockerUrl,
  createReversePennyDrop,
  getDigilockerDocument,
  getDigilockerStatus,
  getReversePennyDropStatus,
  verifySecureIdWebhookSignature
} from "../../shared/cashfreeSecureId.js";
import { signSupabaseAvatarUrl, uploadUserProfileImage } from "../../shared/profileImageUpload.js";

function packageNameByAmount(amount: number) {
  if (amount === 2500) return "Bronze";
  if (amount === 7500) return "Silver";
  if (amount === 15000) return "Gold";
  return "Free ID";
}

/** Same profile shape as dashboard `user` for client screens (e.g. history). */
async function getUserForClientById(userId: number) {
  const currentUser = await prisma.user.findFirst({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      last_name: true,
      father_name: true,
      mobile: true,
      email: true,
      created_at: true,
      updated_at: true,
      sponser_id: true,
      regNo: true,
      account_number: true,
      bank_name: true,
      ifsc: true,
      upi_id: true,
      kyc_status: true,
      user_image: true,
      aadhar_number: true,
      pan_number: true,
      aadhar_front: true,
      aadhar_back: true,
      pan_image: true,
      current_house_no: true,
      current_village: true,
      current_city: true,
      current_state: true,
      current_pincode: true,
      permanent_house_no: true,
      permanent_village: true,
      permanent_city: true,
      permanent_state: true,
      permanent_pincode: true
    }
  });
  if (!currentUser) return null;
  return {
    ...currentUser,
    user_image: await signSupabaseAvatarUrl(currentUser.user_image ?? undefined)
  };
}

export async function dashboard(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(404).json({ status: "done", message: "User Not found." });
  }
  await distributeHoldEarnRewardsForUser(user.regNo);

  const regNo = user.regNo;
  const userForClient = await getUserForClientById(user.id);
  if (!userForClient) {
    return res.status(404).json({ status: "done", message: "User Not found." });
  }

  const [
    bankRows,
    walletRows,
    coinRows,
    settings,
    pkg
  ] = await Promise.all([
    prisma.bank.findMany({ where: { regNo } }),
    prisma.wallet.findMany({ where: { regNo } }),
    prisma.coin.findMany({ where: { regNo } }),
    prisma.setting.findFirst(),
    prisma.perday.findFirst({ where: { regNo }, orderBy: { id: "desc" } })
  ]);
  const sum = (arr: Array<{ amount: any; comment?: string | null }>, comment?: string) =>
    arr
      .filter((x) => (comment ? x.comment === comment : true))
      .reduce((a, b) => a + Number(b.amount ?? 0), 0);
  const packageAmount = Number(pkg?.amount ?? 0);
  const settingsOut = settings
    ? {
        ...settings,
        // Flutter app expects these as ints (not Decimal strings).
        deposit_limit: Number((settings as any).deposit_limit ?? 0),
        deposit_admin_charge: Number((settings as any).deposit_admin_charge ?? 0),
        deposit_gst: Number((settings as any).deposit_gst ?? 0)
      }
    : null;

  const notificationMessage = (process.env.HOME_NOTIFICATION_MESSAGE ?? "").trim();

  return res.json({
    status: "done",
    user: userForClient,
    bank_balance: sum(bankRows),
    income_balance: sum(walletRows),
    total_deposit: sum(bankRows),
    settings: settingsOut,
    Referral_Income: sum(coinRows, "Referral_Income") + sum(coinRows, "Self_Income"),
    Wallet_team_Income: sum(walletRows, "Wallet_team_Income"),
    Wallet_Income: sum(walletRows, "Wallet_Income"),
    Team_Income: sum(walletRows, "level_income"),
    Loan_Services_Income: sum(walletRows, "Loan_Services_Income"),
    Insurance_Services_Income: sum(walletRows, "Insurance_Services_Income"),
    coin_redeam_button: "show",
    coni_bal: sum(coinRows),
    recharge_income: sum(coinRows, "recharge_income"),
    package_amount: packageNameByAmount(Number(packageAmount)),
    notification_message: notificationMessage
  });
}

/** Accepts recharge “payments” until the external operator API is wired; stores a pending row for ops. */
export async function mobileRechargeRequest(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
  const raw = req.body as Record<string, unknown>;
  const mobile = String(raw.mobile ?? "").replace(/\D/g, "");
  const operator = String(raw.operator ?? "").trim() || null;
  const amountNum = Number(raw.amount);
  if (mobile.length !== 10) {
    return res.status(422).json({ status: false, message: "Valid 10-digit mobile required" });
  }
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(422).json({ status: false, message: "Valid amount required" });
  }
  if (!operator) {
    return res.status(422).json({ status: false, message: "Operator is required" });
  }
  await prisma.mobileRechargeRequest.create({
    data: {
      regNo: user.regNo,
      mobile,
      operator,
      amount: amountNum
    }
  });
  return res.json({
    status: true,
    message: "Payment request received. Your recharge will be processed shortly."
  });
}

/** Stores digital declaration acceptance with user id, IP, and server timestamp (audit). */
export async function digitalDeclarationAccept(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
  const raw = req.body as Record<string, unknown>;
  const requestedUserId = Number(raw.userId);
  const agreed =
    raw.agreed === true ||
    String(raw.agreed ?? "").trim().toLowerCase() === "true" ||
    String(raw.agreed ?? "").trim() === "1";
  const context = String(raw.context ?? "hold_earn").trim() || "hold_earn";
  const declarationVersion = String(raw.declarationVersion ?? "v1").trim() || "v1";
  const fullTextSnapshotRaw = String(raw.fullTextSnapshot ?? "").trim();
  if (!Number.isFinite(requestedUserId) || requestedUserId <= 0) {
    return res.status(422).json({ success: false, status: false, message: "Valid userId is required." });
  }
  if (requestedUserId !== user.id) {
    return res.status(403).json({ success: false, status: false, message: "userId mismatch for authenticated user." });
  }
  if (!agreed) {
    return res.status(422).json({ success: false, status: false, message: "agreed must be true." });
  }
  const ip = clientIp(req);
  await prisma.digitalDeclarationAudit.create({
    data: {
      userId: user.id,
      regNo: user.regNo ?? null,
      ipAddress: ip.length > 0 ? ip : null,
      context,
      agreed: true,
      declarationVersion,
      fullTextSnapshot: fullTextSnapshotRaw.length > 0 ? fullTextSnapshotRaw : null,
    }
  });
  return res.json({
    success: true,
    status: true,
    message: "Declaration accepted",
    data: {
      userId: user.id,
      agreed: true,
      context,
      ipAddress: ip.length > 0 ? ip : null,
      timestamp: new Date().toISOString(),
      declarationVersion
    }
  });
}

/** Queues a Hold & Earn application for ops / future payment integration. */
export async function holdEarnSubmit(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
  const raw = req.body as Record<string, unknown>;
  const birthDateRaw = String(raw.birth_date ?? "").trim();
  const birthDate = birthDateRaw ? new Date(birthDateRaw) : null;
  if (!birthDate || Number.isNaN(birthDate.getTime())) {
    return res.status(422).json({ status: false, message: "Valid birth_date is required" });
  }
  const now = new Date();
  const adultCutoff = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  if (birthDate > adultCutoff) {
    return res.status(422).json({ status: false, message: "Minimum age is 18 years for Hold & Earn" });
  }
  const kycUser = await prisma.user.findFirst({
    where: { id: user.id },
    select: { aadhar_number: true, pan_number: true },
  });
  const hasAadhar = Boolean(String(kycUser?.aadhar_number ?? "").trim());
  const hasPan = Boolean(String(kycUser?.pan_number ?? "").trim());
  if (!hasAadhar || !hasPan) {
    return res.status(422).json({
      status: false,
      message: "Full KYC required (Aadhaar and PAN) before Hold & Earn.",
    });
  }

  const fundSource = String(raw.fund_source ?? "").trim();
  const lockMonths = Number(raw.lock_months);
  const amountNum = Number(raw.amount);
  const autoRenew = String(raw.auto_renew ?? "").trim().toLowerCase() === "true";
  const rewardFrequencyRaw = String(raw.reward_frequency ?? "").trim().toLowerCase();
  const rewardFrequency =
    rewardFrequencyRaw === "daily" || rewardFrequencyRaw === "monthly" ? rewardFrequencyRaw : "monthly";
  let agreementDate: Date | null = null;
  const adRaw = raw.agreement_date;
  if (typeof adRaw === "string" && adRaw.length > 0) {
    const d = new Date(adRaw);
    if (!Number.isNaN(d.getTime())) agreementDate = d;
  }
  if (fundSource !== "reward_balance" && fundSource !== "own_funds") {
    return res.status(422).json({ status: false, message: "Invalid fund source" });
  }
  if (![6, 12, 25].includes(lockMonths)) {
    return res.status(422).json({ status: false, message: "Lock-in must be 6, 12, or 25 months" });
  }
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(422).json({ status: false, message: "Valid amount required" });
  }
  if (amountNum < 10000) {
    return res.status(422).json({ status: false, message: "Minimum Hold & Earn amount is 10000" });
  }
  const created = await prisma.holdEarnRequest.create({
    data: {
      regNo: user.regNo,
      amount: amountNum,
      fundSource,
      birthDate,
      lockMonths,
      agreementDate,
      autoRenew,
      rewardFrequency,
      lastRewardAt: null,
      status: "pending"
    }
  });
  return res.json({
    status: true,
    message: "Hold & Earn request received.",
    data: {
      id: created.id,
      agreement_date: created.agreementDate?.toISOString() ?? null
    }
  });
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function holdEarnRatePercent(freq: "daily" | "monthly"): number {
  if (freq === "daily") {
    return Number(process.env.HOLD_EARN_DAILY_RATE_PERCENT ?? "0.05");
  }
  return Number(process.env.HOLD_EARN_MONTHLY_RATE_PERCENT ?? "1.5");
}

function safePeriodCount(from: Date, to: Date, freq: "daily" | "monthly"): number {
  if (to <= from) return 0;
  if (freq === "daily") {
    const ms = to.getTime() - from.getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, months);
}

async function distributeHoldEarnRewardsForUser(regNo: string) {
  const now = new Date();
  const active = await prisma.holdEarnRequest.findMany({
    where: { regNo, status: "active" },
    orderBy: { id: "desc" },
  });
  for (const h of active) {
    const freq = (h.rewardFrequency === "daily" ? "daily" : "monthly") as "daily" | "monthly";
    const from = h.lastRewardAt ?? h.lockedAt ?? h.createdAt;
    if (!from) continue;
    const periods = safePeriodCount(from, now, freq);
    if (periods <= 0) continue;
    const ratePct = holdEarnRatePercent(freq);
    if (!Number.isFinite(ratePct) || ratePct <= 0) continue;
    const principal = Number(h.amount ?? 0);
    if (!Number.isFinite(principal) || principal <= 0) continue;
    const rewardEach = roundMoney((principal * ratePct) / 100);
    const total = roundMoney(rewardEach * periods);
    if (total <= 0) continue;
    await prisma.coin.create({
      data: {
        regNo,
        amount: total,
        comment: `hold_earn_bonus_${h.id}`,
      },
    });
    await prisma.holdEarnRequest.update({
      where: { id: h.id },
      data: { lastRewardAt: now },
    });
  }
}

function isEarlyWithdrawal(now: Date, agreementDate: Date | null, lockMonths: number): boolean {
  if (!agreementDate) return true;
  const maturity = addMonths(agreementDate, lockMonths);
  return now.getTime() < maturity.getTime();
}

/** Locks principal into hold&earn (Pay Now). */
export async function holdEarnLock(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
  const raw = req.body as Record<string, unknown>;
  const holdId = Number(raw.hold_request_id ?? raw.holdId ?? raw.id);
  if (!Number.isFinite(holdId) || holdId <= 0) {
    return res.status(422).json({ status: false, message: "Valid hold_request_id required" });
  }

  const hold = await prisma.holdEarnRequest.findFirst({
    where: { id: holdId, regNo: user.regNo },
  });
  if (!hold) {
    return res.status(404).json({ status: false, message: "Hold request not found" });
  }
  if (hold.status !== "pending") {
    return res.status(422).json({ status: false, message: `Cannot lock from status: ${hold.status}` });
  }
  const principal = Number(hold.amount ?? 0);
  const kycUser = await prisma.user.findFirst({
    where: { id: user.id },
    select: { aadhar_number: true, pan_number: true },
  });
  const hasAadhar = Boolean(String(kycUser?.aadhar_number ?? "").trim());
  const hasPan = Boolean(String(kycUser?.pan_number ?? "").trim());
  if (!hasAadhar || !hasPan) {
    return res.status(422).json({
      status: false,
      message: "Full KYC required (Aadhaar and PAN) before locking funds.",
    });
  }

  if (!Number.isFinite(principal) || principal < 10000) {
    return res.status(422).json({ status: false, message: "Invalid principal amount" });
  }

  const lockedAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      if (hold.fundSource === "reward_balance") {
        const coinRows = await tx.coin.findMany({ where: { regNo: user.regNo } });
        const available = coinRows.reduce((a, b) => a + Number(b.amount ?? 0), 0);
        if (available < principal) {
          throw new Error("Not Enough reward balance");
        }
        await tx.coin.create({
          data: {
            regNo: user.regNo,
            amount: -1 * principal,
            comment: `hold_earn_lock_${hold.id}`,
          },
        });
      } else if (hold.fundSource === "own_funds") {
        const bankRows = await tx.bank.findMany({ where: { regNo: user.regNo } });
        const available = bankRows.reduce((a, b) => a + Number(b.amount ?? 0), 0);
        if (available < principal) {
          throw new Error("Not Enough own funds");
        }
        await tx.bank.create({
          data: {
            regNo: user.regNo,
            status: "pending",
            amount: -1 * principal,
            comment: `hold_earn_lock_${hold.id}`,
            txn_type: "debit",
          },
        });
      } else {
        throw new Error("Invalid fund source");
      }

      await tx.holdEarnRequest.update({
        where: { id: hold.id },
        data: {
          status: "active",
          lockedAt,
        },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not lock Hold & Earn";
    return res.status(422).json({ status: false, message: msg });
  }

  return res.json({
    status: true,
    message: "Hold & Earn locked.",
    data: {
      id: hold.id,
      locked_at: lockedAt.toISOString()
    }
  });
}

/** Withdrawal rules: early = 20% principal penalty, remove earned rewards; apply TDS + 18% GST. */
export async function holdEarnWithdraw(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
  const raw = req.body as Record<string, unknown>;
  const holdId = Number(raw.hold_request_id ?? raw.holdId ?? raw.id);
  if (!Number.isFinite(holdId) || holdId <= 0) {
    return res.status(422).json({ status: false, message: "Valid hold_request_id required" });
  }

  await distributeHoldEarnRewardsForUser(user.regNo);

  const hold = await prisma.holdEarnRequest.findFirst({
    where: { id: holdId, regNo: user.regNo },
  });
  if (!hold) {
    return res.status(404).json({ status: false, message: "Hold request not found" });
  }
  if (hold.status !== "active") {
    return res.status(422).json({ status: false, message: `Cannot withdraw from status: ${hold.status}` });
  }

  const now = new Date();
  const principal = Number(hold.amount ?? 0);
  if (!Number.isFinite(principal) || principal <= 0) {
    return res.status(422).json({ status: false, message: "Invalid principal amount" });
  }

  const early = isEarlyWithdrawal(now, hold.agreementDate ?? null, hold.lockMonths ?? 0);

  let penalty = 0;
  let tds = 0;
  let gst = 0;
  let net = principal;

  if (early) {
    penalty = roundMoney(principal * 0.2);
    const setting = (await prisma.setting.findFirst()) ?? ({} as any);
    const tdsPercent = Number(setting.income_wallet_withdraw_tds ?? 0);
    tds = roundMoney((penalty * tdsPercent) / 100);
    // Per spec: GST 18% on fees/penalties.
    gst = roundMoney(penalty * 0.18);
    net = roundMoney(principal - penalty - tds - gst);

    // Remove earned rewards (Bonus Wallet credits) by reversing matching bonus coin entries.
    const bonusPrefix = `hold_earn_bonus_${hold.id}`;
    const bonusRows = await prisma.coin.findMany({
      where: {
        regNo: user.regNo,
        comment: { startsWith: bonusPrefix },
      },
    });
    const totalBonus = bonusRows.reduce((a, b) => {
      const amt = Number(b.amount ?? 0);
      return a + (amt > 0 ? amt : 0);
    }, 0);
    if (totalBonus > 0) {
      await prisma.coin.create({
        data: {
          regNo: user.regNo,
          amount: -1 * totalBonus,
          comment: `hold_earn_bonus_removed_${hold.id}`,
        },
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.holdEarnRequest.update({
      where: { id: hold.id },
      data: {
        status: early ? "early_withdrawn" : "withdrawn",
        withdrawnAt: now,
        penaltyAmount: early ? penalty : null,
        tdsAmount: early ? tds : null,
        gstAmount: early ? gst : null,
        netAmount: net,
      },
    });

    if (hold.fundSource === "reward_balance") {
      await tx.coin.create({
        data: {
          regNo: user.regNo,
          amount: net,
          comment: `hold_earn_withdraw_${hold.id}`,
        },
      });
    } else if (hold.fundSource === "own_funds") {
      await tx.bank.create({
        data: {
          regNo: user.regNo,
          status: "pending",
          amount: net,
          comment: `hold_earn_withdraw_${hold.id}`,
          txn_type: "credit",
        },
      });
    }
  });

  return res.json({
    status: true,
    message: early ? "Early withdrawal processed (penalty + taxes applied)." : "Withdrawal processed.",
    data: {
      hold_id: hold.id,
      early,
      principal,
      penalty_amount: early ? penalty : 0,
      tds_amount: early ? tds : 0,
      gst_amount: early ? gst : 0,
      net_amount: net,
    }
  });
}

export async function holdEarnActive(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
  await distributeHoldEarnRewardsForUser(user.regNo);
  const active = await prisma.holdEarnRequest.findMany({
    where: {
      regNo: user.regNo,
      status: { in: ["pending", "active"] },
    },
    orderBy: { id: "desc" },
    take: 5,
  });
  return res.json({ status: true, data: active });
}

function ledgerNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function ledgerTs(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeStatus(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["approved", "paid", "success", "successful", "done", "completed", "complete", "active", "withdrawn", "early_withdrawn"].includes(s)) {
    return "approved";
  }
  if (["pending", "cancelled", "canceled", "failed", "failure", "rejected", "expired", "dropped", "user_dropped", "incomplete"].includes(s)) {
    return "rejected";
  }
  return s;
}

function isCompletedStatus(raw: unknown): boolean {
  return normalizeStatus(raw) === "approved";
}

const AADHAAR_KYC_FEE = 10;
const AADHAAR_KYC_FEE_COMMENT = "aadhaar_kyc_verification_fee";

/** Adds debit_amount, credit_amount, balance_after (running total, oldest→newest). */
function enrichLedgerRowsWithDebitCreditBalance(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const asc = [...rows].sort((a, b) => {
    const ta = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
    const tb = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.ledger_id ?? "").localeCompare(String(b.ledger_id ?? ""));
  });
  let running = 0;
  const byLedger = new Map<string, { debit: number | null; credit: number | null; balance: number }>();
  for (const r of asc) {
    const amt = ledgerNum(r.amount);
    running += amt;
    const debit = amt < 0 ? roundMoney(Math.abs(amt)) : null;
    const credit = amt > 0 ? roundMoney(amt) : null;
    const lid = String(r.ledger_id ?? `w_${r.id}`);
    byLedger.set(lid, {
      debit,
      credit,
      balance: roundMoney(running)
    });
  }
  for (const r of rows) {
    const lid = String(r.ledger_id ?? `w_${r.id}`);
    const e = byLedger.get(lid);
    if (e) {
      r.debit_amount = e.debit;
      r.credit_amount = e.credit;
      r.balance_after = e.balance;
    }
  }
}

/** Merged audit trail: income wallet, bank wallet, deposit requests, coin wallet, online (Cashfree) payments, mobile recharge queue. */
export async function buildFullTransactionLedger(regNo: string) {
  const [wallets, banks, deposits, coins, cfOrders, rechargePending, holdEarnRows] = await Promise.all([
    prisma.wallet.findMany({ where: { regNo } }),
    prisma.bank.findMany({ where: { regNo } }),
    prisma.deposit.findMany({ where: { regNo } }),
    prisma.coin.findMany({ where: { regNo } }),
    prisma.cashfreeOrder.findMany({ where: { reg_no: regNo }, orderBy: { id: "desc" } }),
    prisma.mobileRechargeRequest.findMany({ where: { regNo }, orderBy: { id: "desc" } }),
    prisma.holdEarnRequest.findMany({ where: { regNo }, orderBy: { id: "desc" } }),
  ]);

  const rows: Record<string, unknown>[] = [];

  for (const w of wallets) {
    if (w.status != null && !isCompletedStatus(w.status)) continue;
    rows.push({
      ledger_id: `w_${w.id}`,
      ledger_source: "income_wallet",
      id: w.id,
      regNo: w.regNo,
      amount: ledgerNum(w.amount),
      comment: w.comment ?? "",
      created_at: ledgerTs(w.created_at ?? w.updated_at),
      updated_at: ledgerTs(w.updated_at ?? w.created_at),
      status: normalizeStatus(w.status),
      txn_type: w.txn_type ?? null,
      level: w.level ?? null,
      gst: ledgerNum(w.gst),
      tds: ledgerNum(w.tds),
      amount_to_pay: ledgerNum(w.amount_to_pay),
      service_charge: ledgerNum(w.service_charge),
      source_id: w.source_id ?? null,
      payment_method: null,
      txn: null,
      total_amount: null,
      admin_charge: null,
      deposit_principal: null
    });
  }

  for (const b of banks) {
    if (b.status != null && !isCompletedStatus(b.status)) continue;
    rows.push({
      ledger_id: `b_${b.id}`,
      ledger_source: "bank_wallet",
      id: b.id,
      regNo: b.regNo,
      amount: ledgerNum(b.amount),
      comment: b.comment ?? "",
      created_at: ledgerTs(b.created_at ?? b.updated_at),
      updated_at: ledgerTs(b.updated_at ?? b.created_at),
      status: normalizeStatus(b.status),
      txn_type: b.txn_type ?? null,
      level: null,
      gst: null,
      tds: null,
      amount_to_pay: null,
      service_charge: null,
      source_id: null,
      payment_method: null,
      txn: null,
      total_amount: null,
      admin_charge: null,
      deposit_principal: null
    });
  }

  for (const d of deposits) {
    const st = String(d.status ?? "").toLowerCase();
    if (!isCompletedStatus(st)) continue;
    const showAmount = ledgerNum(d.total_amount);
    rows.push({
      ledger_id: `d_${d.id}`,
      ledger_source: "deposit",
      id: d.id,
      regNo: d.regNo,
      amount: showAmount,
      comment: `Wallet deposit (${d.status ?? "unknown"})`,
      created_at: ledgerTs(d.created_at),
      updated_at: ledgerTs(d.updated_at),
      status: normalizeStatus(d.status),
      txn_type: "credit",
      level: null,
      gst: ledgerNum(d.gst),
      tds: null,
      amount_to_pay: null,
      service_charge: null,
      source_id: null,
      payment_method: d.payment_method ?? null,
      txn: d.txn ?? null,
      total_amount: ledgerNum(d.total_amount),
      admin_charge: ledgerNum(d.admin_charge),
      deposit_principal: ledgerNum(d.amount)
    });
  }

  for (const c of coins) {
    rows.push({
      ledger_id: `c_${c.id}`,
      ledger_source: "coin_wallet",
      id: c.id,
      regNo: c.regNo,
      amount: ledgerNum(c.amount),
      comment: c.comment ?? "",
      created_at: ledgerTs(c.created_at ?? c.updated_at),
      updated_at: ledgerTs(c.updated_at ?? c.created_at),
      status: null,
      txn_type: null,
      level: null,
      gst: null,
      tds: null,
      amount_to_pay: null,
      service_charge: null,
      source_id: null,
      payment_method: null,
      txn: null,
      total_amount: null,
      admin_charge: null,
      deposit_principal: null
    });
  }

  const purposeLabel: Record<string, string> = {
    package_purchase: "Package purchase (online)",
    cibil_report: "CIBIL report (online)",
    loan_service: "Loan service fee (online)"
  };

  for (const o of cfOrders) {
    const paid = isCompletedStatus(o.status);
    if (!paid) continue;
    rows.push({
      ledger_id: `cf_${o.id}`,
      ledger_source: "online_payment",
      id: o.id,
      regNo: o.reg_no,
      amount: -ledgerNum(o.order_amount),
      comment: purposeLabel[o.purpose] ?? `Online payment (${o.purpose})`,
      created_at: ledgerTs(o.created_at),
      updated_at: ledgerTs(o.updated_at),
      status: normalizeStatus(o.status),
      txn_type: "debit",
      level: null,
      gst: null,
      tds: null,
      amount_to_pay: null,
      service_charge: null,
      source_id: null,
      payment_method: "Cashfree",
      txn: o.order_id,
      total_amount: ledgerNum(o.order_amount),
      admin_charge: null,
      deposit_principal: null
    });
  }

  // Pending mobile recharge requests are intentionally hidden from history
  // until they are processed into completed wallet/bank ledger entries.
  void rechargePending;

  for (const h of holdEarnRows) {
    const status = String(h.status ?? "");
    rows.push({
      ledger_id: `he_${h.id}`,
      ledger_source: "hold_earn",
      id: h.id,
      regNo: h.regNo,
      amount: status === "active" ? -ledgerNum(h.amount) : ledgerNum(h.netAmount ?? 0),
      comment: `Hold & Earn (${status || "pending"})`,
      created_at: ledgerTs(h.createdAt),
      updated_at: ledgerTs(h.withdrawnAt ?? h.lockedAt ?? h.createdAt),
      status: normalizeStatus(status),
      txn_type: status === "active" ? "debit" : status.includes("withdraw") ? "credit" : "pending",
      level: null,
      gst: ledgerNum(h.gstAmount),
      tds: ledgerNum(h.tdsAmount),
      amount_to_pay: ledgerNum(h.netAmount),
      service_charge: ledgerNum(h.penaltyAmount),
      source_id: null,
      payment_method: h.fundSource,
      txn: `HE${h.id}`,
      total_amount: ledgerNum(h.amount),
      admin_charge: null,
      deposit_principal: ledgerNum(h.amount),
    });
  }

  enrichLedgerRowsWithDebitCreditBalance(rows);

  rows.sort((a, b) => {
    const ta = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
    const tb = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
    return tb - ta;
  });

  return rows;
}

export async function walletHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }
  await distributeHoldEarnRewardsForUser(user.regNo);

  const comment = req.params.comment;
  const mergeAll = String((req.query as { merge?: string }).merge ?? "") === "all";

  if (mergeAll && !comment) {
    try {
      const rows = await buildFullTransactionLedger(user.regNo);
      const userForClient = (await getUserForClientById(user.id)) ?? {
        id: user.id,
        regNo: user.regNo,
        mobile: user.mobile
      };
      return res.json({
        status: "done",
        wallet_history: rows,
        user: userForClient,
        ledger_scope: "full"
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load transaction history";
      // eslint-disable-next-line no-console
      console.error("buildFullTransactionLedger", e);
      return res.status(500).json({ status: false, message: msg });
    }
  }

  try {
    const raw = await prisma.wallet.findMany({
      where: { regNo: user.regNo, ...(comment ? { comment } : {}) }
    });
    const filtered = raw.filter((w) => w.status == null || isCompletedStatus(w.status));
    const rows: Record<string, unknown>[] = filtered.map((w) => ({
      ledger_id: `w_${w.id}`,
      ledger_source: "income_wallet",
      id: w.id,
      regNo: w.regNo,
      amount: ledgerNum(w.amount),
      comment: w.comment ?? "",
      created_at: ledgerTs(w.created_at ?? w.updated_at),
      updated_at: ledgerTs(w.updated_at ?? w.created_at),
      status: normalizeStatus(w.status),
      txn_type: w.txn_type ?? null,
      level: w.level ?? null,
      gst: ledgerNum(w.gst),
      tds: ledgerNum(w.tds),
      amount_to_pay: ledgerNum(w.amount_to_pay),
      service_charge: ledgerNum(w.service_charge),
      source_id: w.source_id != null ? String(w.source_id) : null,
      payment_method: null,
      txn: null,
      total_amount: null,
      admin_charge: null,
      deposit_principal: null
    }));
    enrichLedgerRowsWithDebitCreditBalance(rows);
    rows.sort((a, b) => {
      const ta = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
      const tb = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
      return tb - ta;
    });
    const userForClient = (await getUserForClientById(user.id)) ?? {
      id: user.id,
      regNo: user.regNo,
      mobile: user.mobile
    };
    return res.json({
      status: "done",
      wallet_history: rows,
      user: userForClient,
      ledger_scope: comment ? "filtered" : "income_wallet"
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load wallet history";
    return res.status(500).json({ status: false, message: msg });
  }
}

export async function coinHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(404).json({ status: "done", message: "User Not found." });
  }

  const rows = await prisma.coin.findMany({ where: { regNo: user.regNo } });
  return res.json({ status: "done", wallet_history: rows, user });
}

export async function depositHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(404).json({ status: "done", message: "User Not found." });
  }

  const rows = await prisma.deposit.findMany({ where: { regNo: user.regNo } });
  return res.json({ status: "done", wallet_history: rows });
}

export async function bankHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(404).json({ status: "done", message: "User Not found." });
  }

  const walletHistory = await prisma.bank.findMany({ where: { regNo: user.regNo } });
  const bankBalance = walletHistory.reduce((a, b) => a + Number(b.amount ?? 0), 0);
  return res.json({
    status: "done",
    wallet_history: walletHistory,
    bank_balance: bankBalance
  });
}

export async function myDirects(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: "error", message: "Token invalid" });
  const regNo = (req.body as { regNo?: string }).regNo ?? user.regNo;

  const directs = await prisma.user.findMany({ where: { sponser_id: regNo } });
  const enriched = await Promise.all(
    directs.map(async (u) => {
      const pkg = await prisma.perday.findFirst({ where: { regNo: u.regNo ?? "" }, orderBy: { id: "desc" } });
      const packageAmount = Number(pkg?.amount ?? 0);
      const signedImage = await signSupabaseAvatarUrl(u.user_image ?? undefined);
      return {
        ...u,
        user_image: signedImage ?? u.user_image,
        status: pkg ? "Active" : "Inactive",
        package_amount: packageAmount,
        package_name: packageNameByAmount(Number(packageAmount))
      };
    })
  );

  return res.json({
    status: "done",
    regNo,
    my_directs: enriched,
    login_user: user
  });
}

export async function createTicket(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Token invalid" });
  const { subject, message } = req.body as { subject?: string; message?: string };
  if (!subject || !message) {
    return res.status(422).json({ status: false, v_errors: { subject: ["Subject and message required"] } });
  }
  await prisma.supportTicket.create({ data: { regNo: user.regNo, subject, message, status: "open" } });
  return res.json({ status: true, message: "Support ticket created successfully." });
}

export async function myTickets(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Token invalid" });
  const tickets = await prisma.supportTicket.findMany({ where: { regNo: user.regNo }, orderBy: { id: "desc" } });
  return res.json({ status: true, data: tickets });
}

export async function deposit2(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const amount = Number((req.body as { amount?: number }).amount);
  if (!user || !Number.isFinite(amount) || amount <= 0) {
    return res.status(422).json({ status: false, v_errors: { amount: ["Amount is required."] } });
  }
  const setting = ((await prisma.setting.findFirst()) ?? {}) as Record<string, number>;
  const oldDeposits = (await prisma.bank.findMany({ where: { regNo: user.regNo } })).reduce(
    (a, b) => a + Number(b.amount ?? 0),
    0
  );
  const limit = Number(setting.deposit_limit ?? 0);
  const chargeable = oldDeposits < limit ? Math.max(oldDeposits + amount - limit, 0) : amount;
  const adminCharge = Number((((chargeable * Number(setting.deposit_admin_charge ?? 0)) / 100) || 0).toFixed(2));
  const gst = Number((((adminCharge * Number(setting.deposit_gst ?? 0)) / 100) || 0).toFixed(2));
  const total = Number((amount + adminCharge + gst).toFixed(2));
  return res.json({
    status: true,
    message: "Deposit calculation",
    data: { amount, total, gst, admin_charge: adminCharge }
  });
}

export async function deposit(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const body = req.body as Record<string, unknown>;
  const amount = Number(body.amount);
  const totalAmount = Number(body.total_amount);
  const gstInput = Number(body.gst);
  const adminChargeInput = Number(body.admin_charge);
  const txn = String(body.txn ?? "");
  if (!amount || !totalAmount || !body.payment_method || !txn) {
    return res.status(422).json({ status: false, v_errors: { amount: ["Validation failed"] } });
  }
  const txnDup = await prisma.deposit.findFirst({ where: { txn }, select: { id: true } });
  if (txnDup) {
    return res.status(422).json({ status: false, v_errors: { txn: ["This transaction ID has already been used."] } });
  }

  const setting = ((await prisma.setting.findFirst()) ?? {}) as Record<string, number>;
  const oldDeposits = (await prisma.bank.findMany({ where: { regNo: user.regNo } })).reduce(
    (a, b) => a + Number(b.amount ?? 0),
    0
  );
  const limit = Number(setting.deposit_limit ?? 0);
  const chargeable = oldDeposits < limit ? Math.max(oldDeposits + amount - limit, 0) : amount;
  const adminCharge = Number((((chargeable * Number(setting.deposit_admin_charge ?? 0)) / 100) || 0).toFixed(2));
  const gst = Number((((adminCharge * Number(setting.deposit_gst ?? 0)) / 100) || 0).toFixed(2));
  const total = Number((amount + adminCharge + gst).toFixed(2));

  if (Number(adminChargeInput.toFixed(2)) !== adminCharge) {
    return res.status(422).json({ status: false, message: `Admin charge must be ${adminCharge}` });
  }
  if (Number(gstInput.toFixed(2)) !== gst) {
    return res.status(422).json({ status: false, message: `GST must be ${gst}` });
  }
  if (Number(totalAmount.toFixed(2)) !== total) {
    return res.status(422).json({ status: false, message: `Total amount must be ${total}` });
  }

  const now = new Date();
  const createdDeposit = await prisma.deposit.create({
    data: {
      regNo: user.regNo,
      amount,
      payment_method: String(body.payment_method),
      slip: (body.slip as string | null) ?? null,
      status: "pending",
      txn,
      total_amount: total,
      gst,
      admin_charge: adminCharge,
      created_at: now,
      updated_at: now
    }
  });
  return res.json({
    status: true,
    message: "Deposit submitted successfully",
    data: createdDeposit,
    debug: { old_deposit: oldDeposits, chargeable_amount: chargeable }
  });
}

function mlmPercentage(level: number, amount: number) {
  const percentages: Record<number, number> = {
    1: 0.1, 2: 0.1, 3: 0.08, 4: 0.08, 5: 0.06, 6: 0.06, 7: 0.04, 8: 0.02, 9: 0.02, 10: 0.01, 11: 0.005, 12: 0.005
  };
  return amount * (percentages[level] ?? 0);
}

async function levelMlm(regNo: string, amount: number, sourceId: number) {
  let currentReg = regNo;
  for (let level = 1; level <= 12; level += 1) {
    const u = await prisma.user.findFirst({ where: { regNo: currentReg }, select: { regNo: true, sponser_id: true } });
    if (!u || !u.sponser_id) break;
    const sponsor = String(u.sponser_id);
    const eligible = await prisma.perday.findFirst({ where: { regNo: sponsor }, select: { id: true } });
    if (eligible) {
      const dup = await prisma.wallet.findFirst({
        where: { regNo: sponsor, source_id: sourceId, level }
      });
      if (!dup) {
        await prisma.wallet.create({
          data: { regNo: sponsor, amount: mlmPercentage(level, amount), level, source_id: sourceId, comment: "level_income" }
        });
      }
    }
    currentReg = sponsor;
  }
}

function newCashfreeMerchantOrderId(): string {
  return `EXF${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(0, 45);
}

async function fulfillPackagePurchaseFromCashfree(regNo: string, meta: Record<string, unknown>, orderId: string) {
  const amount = Number(meta.package_amount);
  const gst = Number(meta.gst);
  const myTotal = Number(meta.total_amount);
  const sponsorMobileMeta = meta.sponsor_mobile != null && String(meta.sponsor_mobile).length > 0 ? String(meta.sponsor_mobile) : "";

  const u = await prisma.user.findFirst({ where: { regNo }, select: { regNo: true, sponser_id: true } });
  if (!u?.regNo) return;

  if (String(u.sponser_id ?? "0") === "0") {
    if (!sponsorMobileMeta) return;
    const sponsor = await prisma.user.findFirst({
      where: { mobile: sponsorMobileMeta, NOT: { regNo } },
      select: { regNo: true }
    });
    if (!sponsor) return;
    await prisma.user.updateMany({ where: { regNo }, data: { sponser_id: sponsor.regNo } });
  }

  const exists = await prisma.package.findFirst({ where: { regNo, amount } });
  if (exists) return;

  const pkgInsert = await prisma.package.create({
    data: {
      regNo,
      amount,
      payment_method: "Cashfree",
      gst,
      total_amount: myTotal,
      status: "approved",
      txn: orderId
    }
  });
  await prisma.perday.create({ data: { regNo, amount } });
  await levelMlm(regNo, amount, pkgInsert.id);
}

async function fulfillCibilFromCashfree(regNo: string, meta: Record<string, unknown>) {
  const pending = await prisma.cibileReportRequest.findFirst({
    where: { regNo, status: "pending" },
    select: { id: true }
  });
  if (pending) return;

  const appId = `CIBIL${Date.now()}`;
  await prisma.cibileReportRequest.create({
    data: {
      regNo,
      name: String(meta.name),
      m_name: (meta.m_name as string | null) ?? null,
      l_name: (meta.l_name as string | null) ?? null,
      mobile: String(meta.mobile),
      pan_number: String(meta.pan_number),
      status: "pending",
      amount: Number(meta.amount),
      gst: Number(meta.gst),
      total_amount: Number(meta.total_amount),
      application_id: appId
    }
  });
}

async function fulfillLoanFromCashfree(regNo: string, meta: Record<string, unknown>, cashfreeOrderId: string) {
  const existing = await prisma.loan.findFirst({
    where: { regNo, remarks: { contains: cashfreeOrderId } },
    select: { id: true }
  });
  if (existing) return;

  const totalFee = 590;
  const t = new Date();
  const applicationId = `LN${regNo.replace(/\W/g, "")}${t.getTime()}`.slice(0, 48);
  await prisma.loan.create({
    data: {
      regNo,
      name: String(meta.name),
      mobile: String(meta.mobile),
      pan_number: String(meta.pan_number),
      amount: 0,
      loan_type: String(meta.loan_type),
      status: "pending",
      l_name: (meta.l_name as string | null) ?? null,
      m_name: (meta.m_name as string | null) ?? null,
      fee: 500,
      fee_gst: 90,
      total_fee: totalFee,
      remarks: `cashfree_order:${cashfreeOrderId}`,
      application_id: applicationId,
      login_date: t,
      created_at: t,
      updated_at: t
    }
  });
}

export async function purchasePackage(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const body = req.body as Record<string, unknown>;
  const amount = Number(body.amount);
  const totalAmount = Number(body.total_amount);
  const gstInput = Number(body.gst);
  if (!amount || !totalAmount || !body.payment_method || !Number.isFinite(gstInput)) {
    return res.status(422).json({ status: false, v_errors: { amount: ["Validation failed"] } });
  }

  const setting = ((await prisma.setting.findFirst()) ?? {}) as Record<string, number>;
  const gst = Number((((amount * Number(setting.deposit_gst ?? 0)) / 100) || 0).toFixed(2));
  const myTotal = Number((amount + gst).toFixed(2));
  if (gstInput !== gst) return res.status(422).json({ status: false, message: `GST must be ${gst}` });
  if (Number(totalAmount.toFixed(2)) !== myTotal) {
    return res.status(422).json({ status: false, message: `Total amount must be ${myTotal}` });
  }

  const exists = await prisma.package.findFirst({ where: { regNo: user.regNo, amount } });
  if (exists) return res.status(500).json({ status: false, message: "This package is already purchased." });

  if (String(user.sponser_id ?? "0") === "0") {
    const sponsorMobile = String(body.sponser_id ?? "");
    if (!sponsorMobile) return res.status(500).json({ status: false, message: "sponsor not found." });
    const sponsor = await prisma.user.findFirst({
      where: { mobile: sponsorMobile, NOT: { regNo: user.regNo } },
      select: { regNo: true }
    });
    if (!sponsor) return res.status(500).json({ status: false, message: "sponsor not found." });
    await prisma.user.updateMany({ where: { regNo: user.regNo }, data: { sponser_id: sponsor.regNo } });
  }

  const bankRows = await prisma.bank.findMany({ where: { regNo: user.regNo } });
  if (bankRows.reduce((a, b) => a + Number(b.amount ?? 0), 0) < myTotal) {
    return res.status(500).json({ status: false, message: "Not Enough Balance." });
  }

  await prisma.bank.create({
    data: { regNo: user.regNo, amount: -1 * myTotal, comment: `activate ${amount} package`, txn_type: "debit" }
  });
  const pkgInsert = await prisma.package.create({
    data: {
      regNo: user.regNo,
      amount,
      payment_method: String(body.payment_method),
      gst,
      total_amount: myTotal,
      status: "approved"
    }
  });
  await prisma.perday.create({ data: { regNo: user.regNo, amount } });
  await levelMlm(user.regNo, amount, pkgInsert.id);

  return res.json({ status: true, message: "packages purchased successfully" });
}

export async function purchasePackageHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(404).json({ status: "done", message: "User Not found." });
  const packages = await prisma.package.findMany({ where: { regNo: user.regNo } });
  return res.json({ status: "done", packages });
}

export async function bankWalletWithdraw(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const amount = Number((req.body as { amount?: number | string }).amount);
  if (!user) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(422).json({ status: false, v_errors: { amount: ["Amount is required."] } });
  }
  if (amount < 500 || amount % 500 !== 0) {
    return res.status(422).json({
      status: false,
      message: "Minimum withdrawal is 500 and must be in multiples of 500.",
    });
  }

  const bankRows = await prisma.bank.findMany({ where: { regNo: user.regNo } });
  const available = bankRows.reduce((a, b) => a + Number(b.amount ?? 0), 0);
  if (available < amount) {
    return res.status(400).json({ status: false, message: "Not Enough Balance" });
  }

  await prisma.bank.create({
    data: {
      regNo: user.regNo,
      amount: -1 * amount,
      comment: "withdraw",
      txn_type: "debit",
      status: "pending",
    },
  });

  return res.json({ status: true, message: "Withdrawal request submitted successfully" });
}

export async function incomeWalletWithdraw(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const amount = Number((req.body as { amount?: number | string }).amount);
  if (!user) {
    return res.status(401).json({ status: false, message: "Invalid or expired token" });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(422).json({ status: false, v_errors: { amount: ["Amount is required."] } });
  }
  if (amount < 500 || amount % 500 !== 0) {
    return res.status(422).json({
      status: false,
      message: "Minimum withdrawal is 500 and must be in multiples of 500.",
    });
  }

  const walletRows = await prisma.wallet.findMany({ where: { regNo: user.regNo } });
  const available = walletRows.reduce((a, b) => a + Number(b.amount ?? 0), 0);
  if (available < amount) {
    return res.status(400).json({ status: false, message: "Not Enough Balance" });
  }

  await prisma.wallet.create({
    data: {
      regNo: user.regNo,
      amount: -1 * amount,
      comment: "withdraw",
      txn_type: "debit",
      status: "pending",
    },
  });

  return res.json({ status: true, message: "Withdrawal request submitted successfully" });
}

export async function coinWalletWithdraw(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const amount = Number((req.body as { amount?: number }).amount);
  if (!user || !amount || amount <= 0) {
    return res.status(422).json({ status: false, v_errors: { amount: ["Amount is required."] } });
  }
  const hasPrev = await prisma.coin.findFirst({ where: { regNo: user.regNo, comment: "withdraw" } });
  if (!hasPrev && amount < 1500) {
    return res.json({ status: false, message: "First withdraw minimum 1500 Rs required" });
  }
  const balRows = await prisma.coin.findMany({ where: { regNo: user.regNo } });
  if (balRows.reduce((a, b) => a + Number(b.amount ?? 0), 0) < amount) return res.json({ status: false, message: "Not Enough Balance" });

  await prisma.wallet.create({ data: { regNo: user.regNo, amount, comment: "coin_redeam" } });
  await prisma.coin.create({ data: { regNo: user.regNo, amount: -1 * amount, comment: "withdraw" } });
  return res.json({ status: "done", message: "Successfully Withdraw" });
}

export async function bankWalletWithdrawCancel(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(404).json({ status: "done", message: "User Not found." });
  const walletHistory = await prisma.bank.findMany({ where: { regNo: user.regNo, comment: "withdraw" } });
  const balRows = await prisma.bank.findMany({ where: { regNo: user.regNo } });
  return res.json({ status: "done", wallet_history: walletHistory, bank_balance: balRows.reduce((a, b) => a + Number(b.amount ?? 0), 0) });
}

export async function incomeWalletWithdrawCancel(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(404).json({ status: "done", message: "User Not found." });
  const walletHistory = await prisma.wallet.findMany({ where: { regNo: user.regNo, comment: "withdraw" } });
  const balRows = await prisma.wallet.findMany({ where: { regNo: user.regNo } });
  return res.json({ status: "done", wallet_history: walletHistory, bank_balance: balRows.reduce((a, b) => a + Number(b.amount ?? 0), 0) });
}

export async function updatePassword(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid or expired token" });
  const body = req.body as Record<string, unknown>;
  const oldPassword = String(body.old_password ?? "");
  const newPassword = String(body.new_password ?? "");
  const confirm = String(body.new_password_confirmation ?? "");
  if (!oldPassword || !newPassword || newPassword.length < 6 || newPassword !== confirm) {
    return res.status(422).json({ status: false, v_errors: { new_password: ["Validation failed"] } });
  }
  const u = await prisma.user.findFirst({ where: { regNo: user.regNo }, select: { regNo: true, password: true } });
  if (!u || !u.password) return res.status(404).json({ status: false, message: "User not found" });
  const ok = await bcrypt.compare(oldPassword, String(u.password));
  if (!ok) return res.status(400).json({ status: false, message: "Old password is incorrect" });
  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.updateMany({ where: { regNo: user.regNo }, data: { password: hashed } });
  return res.json({ status: true, message: "Password updated successfully" });
}

function multipartString(body: Request["body"], key: string): string | undefined {
  const raw = body?.[key];
  if (raw == null) return undefined;
  const s = Array.isArray(raw) ? raw[0] : raw;
  const v = String(s).trim();
  return v.length ? v : undefined;
}

function regNoToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function kycDigilockerVerificationId(regNo: string, documentType: "AADHAAR" | "PAN"): string {
  const prefix = documentType === "AADHAAR" ? "DGLA" : "DGLP";
  return `${prefix}_${regNoToken(regNo)}_${Date.now()}`.slice(0, 50);
}

function bankRpdVerificationId(regNo: string): string {
  return `RPD_${regNoToken(regNo)}_${Date.now()}`.slice(0, 50);
}

function parseRegNoFromVerificationId(verificationId: string): string | null {
  const parts = verificationId.split("_");
  if (parts.length < 3) return null;
  return parts.slice(1, -1).join("_") || null;
}

function deepFindStringByKeys(input: unknown, keys: string[]): string {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  const queue: unknown[] = [input];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      queue.push(...cur);
      continue;
    }
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (wanted.has(k.toLowerCase()) && (typeof v === "string" || typeof v === "number")) {
        const out = String(v).trim();
        if (out.length > 0) return out;
      }
      if (v && typeof v === "object") queue.push(v);
    }
  }
  return "";
}

function normalizeDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function extractAadhaarProfileUpdate(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fullName = deepFindStringByKeys(input, ["full_name", "name", "user_name"]);
  if (fullName) out.name = fullName;

  const fatherName = deepFindStringByKeys(input, ["father_name", "fathers_name", "father"]);
  if (fatherName) out.father_name = fatherName;

  const aadhaarNoRaw = deepFindStringByKeys(input, [
    "aadhaar_number",
    "aadhar_number",
    "masked_aadhaar",
    "masked_aadhar",
    "uid",
    "aadhaar",
    "aadhar"
  ]);
  const aadhaarDigits = normalizeDigits(aadhaarNoRaw);
  if (aadhaarDigits.length >= 4) out.aadhar_number = aadhaarDigits;

  const house = deepFindStringByKeys(input, ["house", "house_no", "house_number", "building", "care_of", "co"]);
  const locality = deepFindStringByKeys(input, ["locality", "street", "landmark", "village", "subdistrict", "district"]);
  const city = deepFindStringByKeys(input, ["city", "district", "post_office", "po"]);
  const state = deepFindStringByKeys(input, ["state"]);
  const pincodeRaw = deepFindStringByKeys(input, ["pincode", "pin_code", "postal_code", "zip"]);
  const pincode = normalizeDigits(pincodeRaw).slice(0, 6);

  if (house) {
    out.current_house_no = house;
    out.permanent_house_no = house;
  }
  if (locality) {
    out.current_village = locality;
    out.permanent_village = locality;
  }
  if (city) {
    out.current_city = city;
    out.permanent_city = city;
  }
  if (state) {
    out.current_state = state;
    out.permanent_state = state;
  }
  if (pincode.length === 6) {
    out.current_pincode = pincode;
    out.permanent_pincode = pincode;
  }
  return out;
}

type SecureIdWebhookPayload = {
  event_type?: string;
  data?: {
    verification_id?: string;
    status?: string;
    ref_id?: string | number;
    reference_id?: string | number;
    completed_at?: string;
    updated_at?: string;
  };
};

export async function uploadProfileAvatar(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid or expired token" });

  const files = req.files as Express.Multer.File[] | undefined;
  const file = files?.find((f) => f.fieldname === "user_image");
  if (!file?.buffer?.length) {
    return res.status(422).json({ status: false, message: "Image file required" });
  }

  try {
    const publicUrl = await uploadUserProfileImage(file.buffer, file.mimetype, user.regNo);
    await prisma.user.updateMany({
      where: { regNo: user.regNo },
      data: { user_image: publicUrl, updated_at: new Date() }
    });
    const clientUrl = (await signSupabaseAvatarUrl(publicUrl)) ?? publicUrl;
    return res.json({
      status: true,
      message: "Profile photo updated",
      user_image: clientUrl
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "invalid_image_type") {
      return res.status(422).json({ status: false, message: "Use JPEG, PNG, or WebP" });
    }
    if (msg === "image_too_large") {
      return res.status(422).json({ status: false, message: "Image too large (max 2MB)" });
    }
    // eslint-disable-next-line no-console
    console.error("uploadProfileAvatar", e);
    const detail = e instanceof Error ? e.message : "Upload failed";
    return res.status(502).json({ status: false, message: detail });
  }
}

export async function updateProfile(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid or expired token" });

  const body = req.body as Request["body"];
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const currentUser = await prisma.user.findFirst({
    where: { regNo: user.regNo },
    select: {
      kyc_status: true,
      name: true,
      father_name: true,
      aadhar_number: true,
      current_house_no: true,
      current_village: true,
      current_city: true,
      current_state: true,
      current_pincode: true,
      permanent_house_no: true,
      permanent_village: true,
      permanent_city: true,
      permanent_state: true,
      permanent_pincode: true,
    },
  });
  const aadhaarLocked = String(currentUser?.kyc_status ?? "").trim() === "1";
  const lockedTextFields = new Set<string>();
  if (aadhaarLocked) {
    const lockCandidates: Array<[string, string | null | undefined]> = [
      ["name", currentUser?.name],
      ["father_name", currentUser?.father_name],
      ["aadhar_number", currentUser?.aadhar_number],
      ["current_house_no", currentUser?.current_house_no],
      ["current_village", currentUser?.current_village],
      ["current_city", currentUser?.current_city],
      ["current_state", currentUser?.current_state],
      ["current_pincode", currentUser?.current_pincode],
      ["permanent_house_no", currentUser?.permanent_house_no],
      ["permanent_village", currentUser?.permanent_village],
      ["permanent_city", currentUser?.permanent_city],
      ["permanent_state", currentUser?.permanent_state],
      ["permanent_pincode", currentUser?.permanent_pincode],
    ];
    for (const [k, v] of lockCandidates) {
      if (String(v ?? "").trim().length > 0) lockedTextFields.add(k);
    }
  }

  const data: {
    name?: string;
    father_name?: string | null;
    email?: string | null;
    aadhar_number?: string | null;
    pan_number?: string | null;
    account_number?: string | null;
    bank_name?: string | null;
    ifsc?: string | null;
    upi_id?: string | null;
    current_house_no?: string | null;
    current_village?: string | null;
    current_city?: string | null;
    current_state?: string | null;
    current_pincode?: string | null;
    permanent_house_no?: string | null;
    permanent_village?: string | null;
    permanent_city?: string | null;
    permanent_state?: string | null;
    permanent_pincode?: string | null;
    user_image?: string;
    aadhar_front?: string;
    aadhar_back?: string;
    pan_image?: string;
    updated_at?: Date;
  } = { updated_at: new Date() };

  const name = multipartString(body, "name");
  if (name !== undefined && !lockedTextFields.has("name")) data.name = name;

  const fatherName = multipartString(body, "father_name");
  if (fatherName !== undefined && !lockedTextFields.has("father_name")) data.father_name = fatherName;

  const email = multipartString(body, "email");
  if (email !== undefined) data.email = email;

  const aadhar = multipartString(body, "aadhar_number");
  if (aadhar !== undefined && !lockedTextFields.has("aadhar_number")) data.aadhar_number = aadhar;

  const pan = multipartString(body, "pan_number");
  if (pan !== undefined) data.pan_number = pan;

  const accountNumber = multipartString(body, "account_number");
  if (accountNumber !== undefined) data.account_number = accountNumber;

  const bankName = multipartString(body, "bank_name");
  if (bankName !== undefined) data.bank_name = bankName;

  const ifsc = multipartString(body, "ifsc");
  if (ifsc !== undefined) data.ifsc = ifsc;

  const upi = multipartString(body, "upi_id");
  if (upi !== undefined) data.upi_id = upi;

  const currentHouseNo = multipartString(body, "current_house_no");
  if (currentHouseNo !== undefined && !lockedTextFields.has("current_house_no")) data.current_house_no = currentHouseNo;
  const currentVillage = multipartString(body, "current_village");
  if (currentVillage !== undefined && !lockedTextFields.has("current_village")) data.current_village = currentVillage;
  const currentCity = multipartString(body, "current_city");
  if (currentCity !== undefined && !lockedTextFields.has("current_city")) data.current_city = currentCity;
  const currentState = multipartString(body, "current_state");
  if (currentState !== undefined && !lockedTextFields.has("current_state")) data.current_state = currentState;
  const currentPincode = multipartString(body, "current_pincode");
  if (currentPincode !== undefined && !lockedTextFields.has("current_pincode")) data.current_pincode = currentPincode;

  const permanentHouseNo = multipartString(body, "permanent_house_no");
  if (permanentHouseNo !== undefined && !lockedTextFields.has("permanent_house_no")) data.permanent_house_no = permanentHouseNo;
  const permanentVillage = multipartString(body, "permanent_village");
  if (permanentVillage !== undefined && !lockedTextFields.has("permanent_village")) data.permanent_village = permanentVillage;
  const permanentCity = multipartString(body, "permanent_city");
  if (permanentCity !== undefined && !lockedTextFields.has("permanent_city")) data.permanent_city = permanentCity;
  const permanentState = multipartString(body, "permanent_state");
  if (permanentState !== undefined && !lockedTextFields.has("permanent_state")) data.permanent_state = permanentState;
  const permanentPincode = multipartString(body, "permanent_pincode");
  if (permanentPincode !== undefined && !lockedTextFields.has("permanent_pincode")) data.permanent_pincode = permanentPincode;

  const userImage = files.find((f) => f.fieldname === "user_image");
  if (userImage?.buffer?.length) {
    try {
      data.user_image = await uploadUserProfileImage(userImage.buffer, userImage.mimetype, user.regNo);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_image_type") {
        return res.status(422).json({ status: false, message: "Use JPEG, PNG, or WebP for profile photo" });
      }
      if (msg === "image_too_large") {
        return res.status(422).json({ status: false, message: "Profile photo too large (max 2MB)" });
      }
      // eslint-disable-next-line no-console
      console.error("updateProfile user_image", e);
      const detail = e instanceof Error ? e.message : "Profile photo upload failed";
      return res.status(502).json({ status: false, message: detail });
    }
  }

  const aadharFront = files.find((f) => f.fieldname === "aadhar_front");
  if (aadharFront?.buffer?.length) {
    try {
      data.aadhar_front = await uploadUserProfileImage(aadharFront.buffer, aadharFront.mimetype, `${user.regNo}_aadhaar_front`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_image_type") {
        return res.status(422).json({ status: false, message: "Use JPEG, PNG, or WebP for Aadhaar front" });
      }
      if (msg === "image_too_large") {
        return res.status(422).json({ status: false, message: "Aadhaar front too large (max 2MB)" });
      }
      return res.status(502).json({ status: false, message: "Aadhaar front upload failed" });
    }
  }

  const aadharBack = files.find((f) => f.fieldname === "aadhar_back");
  if (aadharBack?.buffer?.length) {
    try {
      data.aadhar_back = await uploadUserProfileImage(aadharBack.buffer, aadharBack.mimetype, `${user.regNo}_aadhaar_back`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_image_type") {
        return res.status(422).json({ status: false, message: "Use JPEG, PNG, or WebP for Aadhaar back" });
      }
      if (msg === "image_too_large") {
        return res.status(422).json({ status: false, message: "Aadhaar back too large (max 2MB)" });
      }
      return res.status(502).json({ status: false, message: "Aadhaar back upload failed" });
    }
  }

  const panImage = files.find((f) => f.fieldname === "pan_image");
  if (panImage?.buffer?.length) {
    try {
      data.pan_image = await uploadUserProfileImage(panImage.buffer, panImage.mimetype, `${user.regNo}_pan`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_image_type") {
        return res.status(422).json({ status: false, message: "Use JPEG, PNG, or WebP for PAN image" });
      }
      if (msg === "image_too_large") {
        return res.status(422).json({ status: false, message: "PAN image too large (max 2MB)" });
      }
      return res.status(502).json({ status: false, message: "PAN image upload failed" });
    }
  }

  const keys = Object.keys(data).filter((k) => k !== "updated_at");
  if (!keys.length) {
    delete data.updated_at;
    return res.json({ status: true, message: "Profile updated successfully" });
  }

  await prisma.user.updateMany({
    where: { regNo: user.regNo },
    data
  });
  return res.json({ status: true, message: "Profile updated successfully" });
}

export async function createKycDigilockerUrl(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  try {
    const rawDoc = String((req.body as Record<string, unknown>)?.document_type ?? "AADHAAR")
      .trim()
      .toUpperCase();
    const documentType = rawDoc === "PAN" ? "PAN" : "AADHAAR";

    if (documentType === "AADHAAR") {
      const bankRows = await prisma.bank.findMany({ where: { regNo: user.regNo } });
      const available = bankRows.reduce((a, b) => a + Number(b.amount ?? 0), 0);
      if (available < AADHAAR_KYC_FEE) {
        return res.status(400).json({
          status: false,
          message: `Minimum ${AADHAAR_KYC_FEE} required in E-wallet for Aadhaar verification.`,
        });
      }
    }

    const verificationId = kycDigilockerVerificationId(user.regNo, documentType);
    const redirectUrl = process.env.CASHFREE_SECUREID_DIGILOCKER_REDIRECT_URL;
    const out = await createDigilockerUrl({
      verificationId,
      documents: [documentType],
      userFlow: "signup",
      ...(redirectUrl ? { redirectUrl } : {})
    });
    return res.json({ status: true, message: "Digilocker URL created", data: out });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unable to create Digilocker URL";
    return res.status(502).json({ status: false, message: msg });
  }
}

export async function digilockerStatus(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const verificationId = String(req.query.verification_id ?? "");
  const referenceId = String(req.query.reference_id ?? "");
  if (!verificationId && !referenceId) {
    return res.status(422).json({ status: false, message: "verification_id or reference_id is required" });
  }
  try {
    const out = await getDigilockerStatus({
      ...(verificationId ? { verificationId } : {}),
      ...(referenceId ? { referenceId } : {})
    });
    return res.json({ status: true, data: out });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unable to fetch Digilocker status";
    return res.status(502).json({ status: false, message: msg });
  }
}

export async function digilockerDocument(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const documentType = String(req.params.documentType ?? "").toUpperCase();
  const verificationId = String(req.query.verification_id ?? "");
  const referenceId = String(req.query.reference_id ?? "");
  if (!["AADHAAR", "PAN", "DRIVING_LICENSE"].includes(documentType)) {
    return res.status(422).json({ status: false, message: "Invalid document type" });
  }
  if (!verificationId && !referenceId) {
    return res.status(422).json({ status: false, message: "verification_id or reference_id is required" });
  }
  try {
    const out = await getDigilockerDocument({
      documentType: documentType as "AADHAAR" | "PAN" | "DRIVING_LICENSE",
      ...(verificationId ? { verificationId } : {}),
      ...(referenceId ? { referenceId } : {})
    });
    return res.json({ status: true, data: out });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unable to fetch Digilocker document";
    return res.status(502).json({ status: false, message: msg });
  }
}

export async function createBankReversePennyDrop(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const body = req.body as Record<string, unknown>;
  const holderName = String(body.name ?? "").trim();
  try {
    const verificationId = bankRpdVerificationId(user.regNo);
    const out = await createReversePennyDrop({
      verificationId,
      ...(holderName ? { name: holderName } : {})
    });
    return res.json({ status: true, message: "Reverse penny drop initiated", data: out });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unable to initiate reverse penny drop";
    return res.status(502).json({ status: false, message: msg });
  }
}

export async function bankReversePennyDropStatus(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const verificationId = String(req.query.verification_id ?? "");
  const refId = String(req.query.ref_id ?? "");
  if (!verificationId && !refId) {
    return res.status(422).json({ status: false, message: "verification_id or ref_id is required" });
  }
  try {
    const out = await getReversePennyDropStatus({
      ...(verificationId ? { verificationId } : {}),
      ...(refId ? { refId } : {})
    });
    if (String(out.status ?? "") === "SUCCESS") {
      const accountNo = String(out.bank_account ?? "");
      const ifsc = String(out.ifsc ?? "");
      if (accountNo || ifsc) {
        await prisma.user.updateMany({
          where: { regNo: user.regNo },
          data: {
            ...(accountNo ? { account_number: accountNo } : {}),
            ...(ifsc ? { ifsc } : {}),
            updated_at: new Date()
          }
        });
      }
    }
    return res.json({ status: true, data: out });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unable to fetch reverse penny drop status";
    return res.status(502).json({ status: false, message: msg });
  }
}

export async function secureIdWebhook(req: Request, res: Response) {
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
  const signature = String(req.headers["x-webhook-signature"] ?? "");
  const timestamp = String(req.headers["x-webhook-timestamp"] ?? "");
  if (signature && timestamp && !verifySecureIdWebhookSignature(rawBody, timestamp, signature)) {
    return res.status(401).json({ ok: false, message: "Invalid webhook signature" });
  }

  const payload = (req.body ?? {}) as SecureIdWebhookPayload;
  const eventType = String(payload.event_type ?? "");
  const verificationId = String(payload.data?.verification_id ?? "");
  const regNo = verificationId ? parseRegNoFromVerificationId(verificationId) : null;
  if (!regNo) return res.json({ ok: true });

  if (eventType.startsWith("DIGILOCKER_VERIFICATION_")) {
    const status = String(payload.data?.status ?? "");
    const isAadhaarFlow = verificationId.toUpperCase().startsWith("DGLA_");
    if (status === "AUTHENTICATED") {
      let aadhaarDerivedUpdate: Record<string, unknown> = {};
      if (isAadhaarFlow) {
        try {
          const aadhaarDoc = await getDigilockerDocument({
            documentType: "AADHAAR",
            verificationId,
          });
          aadhaarDerivedUpdate = extractAadhaarProfileUpdate(aadhaarDoc);
        } catch {
          aadhaarDerivedUpdate = {};
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.updateMany({
          where: { regNo },
          data: { kyc_status: 1, updated_at: new Date(), ...aadhaarDerivedUpdate },
        });

        if (!isAadhaarFlow) return;

        const alreadyCharged = await tx.bank.findFirst({
          where: { regNo, comment: AADHAAR_KYC_FEE_COMMENT },
          select: { id: true },
        });
        if (alreadyCharged) return;

        const bankRows = await tx.bank.findMany({ where: { regNo } });
        const available = bankRows.reduce((a, b) => a + Number(b.amount ?? 0), 0);
        if (available < AADHAAR_KYC_FEE) return;

        await tx.bank.create({
          data: {
            regNo,
            amount: -AADHAAR_KYC_FEE,
            comment: AADHAAR_KYC_FEE_COMMENT,
            txn_type: "debit",
            status: "approved",
          },
        });
      });
    } else if (["FAILURE", "CONSENT_DENIED", "EXPIRED"].includes(status)) {
      await prisma.user.updateMany({ where: { regNo }, data: { kyc_status: 2, updated_at: new Date() } });
    }
  } else if (eventType === "VKYC_STATUS_UPDATE") {
    const status = String(payload.data?.status ?? "");
    const normalized = status.trim().toLowerCase();
    const completedAtRaw = (payload.data?.completed_at ?? payload.data?.updated_at) as string | undefined;
    const updateData: Record<string, unknown> = {
      vkyc_status: status || null,
      updated_at: new Date()
    };

    if (verificationId) {
      updateData.vkyc_verification_id = verificationId;
    }

    if (completedAtRaw) {
      const dt = new Date(completedAtRaw);
      if (!Number.isNaN(dt.getTime())) {
        updateData.vkyc_completed_at = dt;
      }
    } else if (status === "SUCCESS") {
      updateData.vkyc_completed_at = new Date();
    }

    // Keep existing Flutter KYC tick working (it currently reads `kyc_status`).
    if (["success", "verified", "done"].includes(normalized)) {
      updateData.kyc_status = 1;
    } else if (["failed", "failure", "closed", "rejected", "consent_denied", "expired"].includes(normalized)) {
      updateData.kyc_status = 2;
    }

    await prisma.user.updateMany({ where: { regNo }, data: updateData });
  }
  return res.json({ ok: true });
}

export async function loanRequest(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const body = req.body as Record<string, unknown>;
  const totalFee = 590;
  if (!body.name || !body.mobile || !body.pan_number || !body.loan_type) {
    return res.status(422).json({ status: false, errors: { message: "Validation failed" } });
  }
  const pending = await prisma.loan.findFirst({ where: { regNo: user.regNo, status: "pending" }, select: { id: true } });
  if (pending) return res.status(409).json({ status: false, message: "Your previous loan request is still pending" });
  const bal = (await prisma.bank.findMany({ where: { regNo: user.regNo } })).reduce((a, b) => a + Number(b.amount ?? 0), 0);
  if (bal < totalFee) {
    return res.status(400).json({ status: false, message: "Not Enough Balance" });
  }

  const nowLoan = new Date();
  const applicationId = `LN${user.regNo.replace(/\W/g, "")}${nowLoan.getTime()}`.slice(0, 48);
  await prisma.$transaction([
    prisma.loan.create({
      data: {
        regNo: user.regNo,
        name: String(body.name),
        mobile: String(body.mobile),
        pan_number: String(body.pan_number),
        amount: 0,
        loan_type: String(body.loan_type),
        status: "pending",
        l_name: (body.l_name as string | null) ?? null,
        m_name: (body.m_name as string | null) ?? null,
        fee: 500,
        fee_gst: 90,
        total_fee: totalFee,
        application_id: applicationId,
        login_date: nowLoan,
        created_at: nowLoan,
        updated_at: nowLoan
      }
    }),
    prisma.bank.create({
      data: { regNo: user.regNo, amount: -1 * totalFee, comment: "loan", txn_type: "debit" }
    })
  ]);

  return res.json({ status: true, message: "Loan request submitted successfully" });
}

export async function loanHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid or expired token" });
  const rows = await prisma.loan.findMany({ where: { regNo: user.regNo }, orderBy: { id: "desc" } });
  return res.json({ status: true, data: rows });
}

export async function insuranceRequest(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const body = req.body as Record<string, unknown>;
  if (!body.name || !body.mobile || !body.pan_number || !body.insurance_type) {
    return res.status(422).json({ status: false, errors: { message: "Validation failed" } });
  }
  const pending = await prisma.insurance.findFirst({ where: { regNo: user.regNo, status: "pending" }, select: { id: true } });
  if (pending) {
    return res.status(409).json({ status: false, message: "Your previous insurance request is still pending" });
  }
  const nowIns = new Date();
  const insAppId = `INS${user.regNo.replace(/\W/g, "")}${nowIns.getTime()}`.slice(0, 48);
  await prisma.insurance.create({
    data: {
      regNo: user.regNo,
      name: String(body.name),
      mobile: String(body.mobile),
      pan_number: String(body.pan_number),
      amount: 0,
      insurance_type: String(body.insurance_type),
      status: "pending",
      l_name: (body.l_name as string | null) ?? null,
      m_name: (body.m_name as string | null) ?? null,
      vehicle_number: (body.vehicle_number as string | null) ?? null,
      application_id: insAppId,
      login_date: nowIns,
      created_at: nowIns,
      updated_at: nowIns
    }
  });
  return res.json({ status: true, message: "Loan request submitted successfully" });
}

export async function insuranceHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid or expired token" });
  const rows = await prisma.insurance.findMany({ where: { regNo: user.regNo }, orderBy: { id: "desc" } });
  return res.json({ status: true, data: rows });
}

export async function cibilSubmit(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const body = req.body as Record<string, unknown>;
  if (!body.name || !body.pan_number || !body.mobile || !body.amount || !body.gst || !body.total_amount) {
    return res.status(422).json({ status: false, errors: { message: "Validation failed" } });
  }
  const pending = await prisma.cibileReportRequest.findFirst({
    where: { regNo: user.regNo, status: "pending" },
    select: { id: true }
  });
  if (pending) return res.status(409).json({ status: false, message: "Previous request still pending" });

  const calculatedGst = 15.25;
  const calculatedTotal = 100;
  if (Number(body.gst) !== calculatedGst) return res.status(400).json({ status: false, message: "Invalid GST amount" });
  if (Number(body.total_amount) !== calculatedTotal) {
    return res.status(400).json({ status: false, message: "Invalid total amount" });
  }
  const balRows = await prisma.bank.findMany({ where: { regNo: user.regNo } });
  if (balRows.reduce((a, b) => a + Number(b.amount ?? 0), 0) < calculatedTotal) {
    return res.status(400).json({ status: false, message: "Not Enough Balance" });
  }
  const appId = `CIBIL${Date.now()}`;
  await prisma.cibileReportRequest.create({
    data: {
      regNo: user.regNo,
      name: String(body.name),
      m_name: (body.m_name as string | null) ?? null,
      l_name: (body.l_name as string | null) ?? null,
      mobile: String(body.mobile),
      pan_number: String(body.pan_number),
      status: "pending",
      amount: Number(body.amount),
      gst: calculatedGst,
      total_amount: calculatedTotal,
      application_id: appId
    }
  });
  await prisma.bank.create({ data: { regNo: user.regNo, amount: -calculatedTotal, comment: "buy_cibil_report", txn_type: "debit" } });
  return res.json({ status: true, message: "CIBIL request submitted successfully" });
}

export async function cibilHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid or expired token" });
  const rows = await prisma.cibileReportRequest.findMany({
    where: { regNo: user.regNo },
    orderBy: { id: "desc" }
  });
  if (!rows.length) return res.json({ status: false, message: "No CIBIL history found" });
  return res.json({ status: true, data: rows });
}

export async function createCashfreeSession(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid token" });
  const cashfreeEnv = (process.env.CASHFREE_ENV ?? "SANDBOX").toUpperCase();

  const profilePhone = normalizeIndianMobile10(user.mobile);
  if (!profilePhone) {
    return res.status(422).json({
      status: false,
      message: "Your profile needs a valid 10-digit mobile number for online payments."
    });
  }

  const body = req.body as Record<string, unknown>;
  const purpose = String(body.purpose ?? "");
  const orderId = newCashfreeMerchantOrderId();

  try {
    if (purpose === "wallet_deposit") {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(422).json({ status: false, v_errors: { amount: ["Amount is required."] } });
      }
      const setting = ((await prisma.setting.findFirst()) ?? {}) as Record<string, number>;
      const oldDeposits = (await prisma.bank.findMany({ where: { regNo: user.regNo } })).reduce(
        (a, b) => a + Number(b.amount ?? 0),
        0
      );
      const limit = Number(setting.deposit_limit ?? 0);
      const chargeable = oldDeposits < limit ? Math.max(oldDeposits + amount - limit, 0) : amount;
      const adminCharge = Number((((chargeable * Number(setting.deposit_admin_charge ?? 0)) / 100) || 0).toFixed(2));
      const gst = Number((((adminCharge * Number(setting.deposit_gst ?? 0)) / 100) || 0).toFixed(2));
      const total = Number((amount + adminCharge + gst).toFixed(2));

      const cf = await cashfreeCreatePgOrder({
        orderId,
        orderAmount: total,
        customerId: user.regNo,
        customerPhone10: profilePhone,
        orderNote: `Wallet deposit ${amount}`
      });
      const cfOrderId = cf.order_id;

      const nowCf = new Date();
      await prisma.deposit.create({
        data: {
          regNo: user.regNo,
          amount,
          payment_method: "Cashfree",
          status: "pending",
          txn: cfOrderId,
          total_amount: total,
          gst,
          admin_charge: adminCharge,
          created_at: nowCf,
          updated_at: nowCf
        }
      });

      return res.json({
        status: true,
        order_id: cf.order_id,
        payment_session_id: cf.payment_session_id,
        order_amount: total,
        cashfree_env: cashfreeEnv
      });
    }

    if (purpose === "package_purchase") {
      const amount = Number(body.amount);
      if (!amount) {
        return res.status(422).json({ status: false, v_errors: { amount: ["Validation failed"] } });
      }

      if (String(user.sponser_id ?? "0") === "0") {
        const sponsorMobile = String(body.sponser_id ?? "");
        if (!sponsorMobile) return res.status(500).json({ status: false, message: "sponsor not found." });
        const sponsor = await prisma.user.findFirst({
          where: { mobile: sponsorMobile, NOT: { regNo: user.regNo } },
          select: { regNo: true }
        });
        if (!sponsor) return res.status(500).json({ status: false, message: "sponsor not found." });
      }

      const exists = await prisma.package.findFirst({ where: { regNo: user.regNo, amount } });
      if (exists) return res.status(500).json({ status: false, message: "This package is already purchased." });

      const setting = ((await prisma.setting.findFirst()) ?? {}) as Record<string, number>;
      const gst = Number((((amount * Number(setting.deposit_gst ?? 0)) / 100) || 0).toFixed(2));
      const myTotal = Number((amount + gst).toFixed(2));

      const sponsorMobileForMeta =
        String(user.sponser_id ?? "0") === "0" ? String(body.sponser_id ?? "") : "";

      const cf = await cashfreeCreatePgOrder({
        orderId,
        orderAmount: myTotal,
        customerId: user.regNo,
        customerPhone10: profilePhone,
        orderNote: `Package ${amount}`
      });
      const cfOrderId = cf.order_id;

      await prisma.cashfreeOrder.create({
        data: {
          order_id: cfOrderId,
          reg_no: user.regNo,
          purpose: "package_purchase",
          order_amount: myTotal,
          meta: {
            package_amount: amount,
            gst,
            total_amount: myTotal,
            ...(sponsorMobileForMeta ? { sponsor_mobile: sponsorMobileForMeta } : {})
          }
        }
      });

      return res.json({
        status: true,
        order_id: cf.order_id,
        payment_session_id: cf.payment_session_id,
        order_amount: myTotal,
        cashfree_env: cashfreeEnv
      });
    }

    if (purpose === "cibil_report") {
      if (!body.name || !body.pan_number || !body.mobile) {
        return res.status(422).json({ status: false, errors: { message: "Validation failed" } });
      }
      const pending = await prisma.cibileReportRequest.findFirst({
        where: { regNo: user.regNo, status: "pending" },
        select: { id: true }
      });
      if (pending) return res.status(409).json({ status: false, message: "Previous request still pending" });

      const custPhone = normalizeIndianMobile10(String(body.mobile));
      if (!custPhone) {
        return res.status(422).json({ status: false, message: "Invalid mobile for CIBIL form" });
      }

      const calculatedGst = 15.25;
      const calculatedTotal = 100;
      const baseAmount = 84.75;

      const cf = await cashfreeCreatePgOrder({
        orderId,
        orderAmount: calculatedTotal,
        customerId: user.regNo,
        customerPhone10: custPhone,
        customerName: String(body.name),
        orderNote: "CIBIL report"
      });
      const cfOrderId = cf.order_id;

      await prisma.cashfreeOrder.create({
        data: {
          order_id: cfOrderId,
          reg_no: user.regNo,
          purpose: "cibil_report",
          order_amount: calculatedTotal,
          meta: {
            name: String(body.name),
            m_name: (body.m_name as string | null) ?? null,
            l_name: (body.l_name as string | null) ?? null,
            mobile: String(body.mobile),
            pan_number: String(body.pan_number),
            amount: baseAmount,
            gst: calculatedGst,
            total_amount: calculatedTotal
          }
        }
      });

      return res.json({
        status: true,
        order_id: cf.order_id,
        payment_session_id: cf.payment_session_id,
        order_amount: calculatedTotal,
        cashfree_env: cashfreeEnv
      });
    }

    if (purpose === "loan_service") {
      if (!body.name || !body.mobile || !body.pan_number || !body.loan_type) {
        return res.status(422).json({ status: false, errors: { message: "Validation failed" } });
      }
      const pending = await prisma.loan.findFirst({
        where: { regNo: user.regNo, status: "pending" },
        select: { id: true }
      });
      if (pending) {
        return res.status(409).json({ status: false, message: "Your previous loan request is still pending" });
      }

      const custPhone = normalizeIndianMobile10(String(body.mobile));
      if (!custPhone) {
        return res.status(422).json({ status: false, message: "Invalid mobile on loan form" });
      }

      const totalFee = 590;

      const cf = await cashfreeCreatePgOrder({
        orderId,
        orderAmount: totalFee,
        customerId: user.regNo,
        customerPhone10: custPhone,
        customerName: String(body.name),
        orderNote: "Loan service CIBIL fee"
      });
      const cfOrderId = cf.order_id;

      await prisma.cashfreeOrder.create({
        data: {
          order_id: cfOrderId,
          reg_no: user.regNo,
          purpose: "loan_service",
          order_amount: totalFee,
          meta: {
            name: String(body.name),
            mobile: String(body.mobile),
            pan_number: String(body.pan_number),
            loan_type: String(body.loan_type),
            l_name: (body.l_name as string | null) ?? null,
            m_name: (body.m_name as string | null) ?? null
          }
        }
      });

      return res.json({
        status: true,
        order_id: cf.order_id,
        payment_session_id: cf.payment_session_id,
        order_amount: totalFee,
        cashfree_env: cashfreeEnv
      });
    }

    return res.status(422).json({ status: false, message: "Unknown payment purpose" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Payment session failed";
    return res.status(502).json({ status: false, message: msg });
  }
}

export async function cashfreeWebhook(req: AuthenticatedRequest, res: Response) {
  const payload = req.body as Record<string, any>;
  const orderId = String(payload?.data?.order?.order_id ?? "");
  const orderStatus = payload?.data?.order?.order_status as string | undefined;
  const paymentStatus = String(payload?.data?.payment?.payment_status ?? "");
  const webhookType = String(payload?.type ?? "");
  const cfPaymentId = payload?.data?.payment?.cf_payment_id ?? null;
  if (!orderId) return res.json({ ok: false });

  // Cashfree PG webhooks (2025-01-01) use data.payment.payment_status === "SUCCESS", not order.order_status "PAID".
  const isPaymentSuccess =
    orderStatus === "PAID" ||
    paymentStatus === "SUCCESS" ||
    webhookType === "PAYMENT_SUCCESS_WEBHOOK";
  const isPaymentFailed =
    paymentStatus === "FAILED" ||
    webhookType === "PAYMENT_FAILED_WEBHOOK" ||
    paymentStatus === "USER_DROPPED" ||
    webhookType === "PAYMENT_USER_DROPPED_WEBHOOK";

  const deposit = await prisma.deposit.findFirst({ where: { txn: orderId } });
  if (deposit) {
    if ((deposit.status ?? "") === "approved") return res.json({ ok: true });

    if (isPaymentSuccess) {
      await prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: "approved", cf_payment_id: cfPaymentId ?? undefined }
      });
      const reg = deposit.regNo;
      if (reg) {
        await prisma.bank.create({
          data: {
            regNo: reg,
            amount: Number(deposit.amount ?? 0),
            comment: "deposit",
            txn_type: "credit"
          }
        });
      }
    } else if (isPaymentFailed || (orderStatus && orderStatus !== "ACTIVE")) {
      await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "rejected" } });
    }
    return res.json({ ok: true });
  }

  const cfRow = await prisma.cashfreeOrder.findUnique({ where: { order_id: orderId } });
  if (!cfRow) return res.json({ ok: false });
  if (cfRow.status === "paid") return res.json({ ok: true });

  if (isPaymentSuccess) {
    const meta = (cfRow.meta ?? {}) as Record<string, unknown>;
    try {
      if (cfRow.purpose === "package_purchase") {
        await fulfillPackagePurchaseFromCashfree(cfRow.reg_no, meta, orderId);
      } else if (cfRow.purpose === "cibil_report") {
        await fulfillCibilFromCashfree(cfRow.reg_no, meta);
      } else if (cfRow.purpose === "loan_service") {
        await fulfillLoanFromCashfree(cfRow.reg_no, meta, orderId);
      }
    } catch (e) {
      console.error("cashfreeWebhook fulfill error", e);
      return res.json({ ok: false });
    }
    await prisma.cashfreeOrder.update({
      where: { id: cfRow.id },
      data: { status: "paid", cf_payment_id: cfPaymentId ?? undefined }
    });
  } else if (isPaymentFailed || (orderStatus && orderStatus !== "ACTIVE")) {
    await prisma.cashfreeOrder.update({ where: { id: cfRow.id }, data: { status: "rejected" } });
  }

  return res.json({ ok: true });
}

