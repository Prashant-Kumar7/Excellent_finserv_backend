import type { Response } from "express";
import bcrypt from "bcryptjs";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { prisma } from "../../shared/db.js";

function packageNameByAmount(amount: number) {
  if (amount === 2500) return "Bronze";
  if (amount === 7500) return "Silver";
  if (amount === 15000) return "Gold";
  return "Free ID";
}

export async function dashboard(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(404).json({ status: "done", message: "User Not found." });
  }

  const regNo = user.regNo;
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

  return res.json({
    status: "done",
    user,
    bank_balance: sum(bankRows),
    income_balance: sum(walletRows),
    total_deposit: sum(bankRows),
    settings,
    Referral_Income: sum(coinRows, "Referral_Income") + sum(coinRows, "Self_Income"),
    Wallet_team_Income: sum(walletRows, "Wallet_team_Income"),
    Wallet_Income: sum(walletRows, "Wallet_Income"),
    Team_Income: sum(walletRows, "level_income"),
    Loan_Services_Income: sum(walletRows, "Loan_Services_Income"),
    Insurance_Services_Income: sum(walletRows, "Insurance_Services_Income"),
    coin_redeam_button: "show",
    coni_bal: sum(coinRows),
    recharge_income: sum(coinRows, "recharge_income"),
    package_amount: packageNameByAmount(Number(packageAmount))
  });
}

export async function walletHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(404).json({ status: "done", message: "User Not found." });
  }

  const comment = req.params.comment;
  const rows = await prisma.wallet.findMany({
    where: { regNo: user.regNo, ...(comment ? { comment } : {}) }
  });

  return res.json({ status: "done", wallet_history: rows, user });
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
      return {
        ...u,
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
      admin_charge: adminCharge
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
  const amount = Number((req.body as { amount?: number }).amount);
  if (!user || !amount || amount <= 0) {
    return res.status(422).json({ status: false, v_errors: { amount: ["Amount is required."] } });
  }
  const balRows = await prisma.bank.findMany({ where: { regNo: user.regNo } });
  if (balRows.reduce((a, b) => a + Number(b.amount ?? 0), 0) < amount) return res.json({ status: false, message: "Not Enough Balance" });
  await prisma.bank.create({
    data: { regNo: user.regNo, status: "pending", amount: -1 * amount, comment: "withdraw", txn_type: "debit" }
  });
  return res.json({ status: "done", message: "successfully withdraw" });
}

export async function incomeWalletWithdraw(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const amount = Number((req.body as { amount?: number }).amount);
  if (!user || !amount || amount <= 0) {
    return res.status(422).json({ status: false, v_errors: { amount: ["Amount is required."] } });
  }
  const balRows = await prisma.wallet.findMany({ where: { regNo: user.regNo } });
  if (balRows.reduce((a, b) => a + Number(b.amount ?? 0), 0) < amount) return res.json({ status: false, message: "Not Enough Balance" });

  const setting = ((await prisma.setting.findFirst()) ?? {}) as Record<string, number>;
  const tds = (amount * Number(setting.income_wallet_withdraw_tds ?? 0)) / 100;
  const serviceCharge = (amount * Number(setting.service_charge ?? 0)) / 100;
  const gst = (serviceCharge * Number(setting.income_wallet_withdraw_gst ?? 0)) / 100;
  const amountToPay = amount - tds - serviceCharge - gst;

  await prisma.wallet.create({
    data: {
      regNo: user.regNo,
      amount: -1 * amount,
      comment: "withdraw",
      status: "pending",
      tds,
      service_charge: serviceCharge,
      gst,
      amount_to_pay: amountToPay
    }
  });
  return res.json({ status: "done", message: "Successfully Withdraw" });
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

export async function updateProfile(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid or expired token" });
  const body = req.body as Record<string, unknown>;
  const fields = [
    "name",
    "email",
    "aadhar_number",
    "pan_number",
    "account_number",
    "bank_name",
    "ifsc",
    "upi_id",
    "aadhar_front",
    "aadhar_back",
    "pan_image",
    "user_image"
  ];
  const set: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) {
    if (f in body) {
      set.push(`${f} = ?`);
      vals.push(body[f]);
    }
  }
  if (!set.length) return res.json({ status: true, message: "Profile updated successfully" });
  vals.push(user.regNo);
  await prisma.user.updateMany({
    where: { regNo: user.regNo },
    data: Object.fromEntries(set.map((x, i) => [x.split(" = ")[0], vals[i]]))
  });
  return res.json({ status: true, message: "Profile updated successfully" });
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
        total_fee: totalFee
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
  if (!rows.length) return res.json({ status: false, message: "No loan history found" });
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
      vehicle_number: (body.vehicle_number as string | null) ?? null
    }
  });
  return res.json({ status: true, message: "Loan request submitted successfully" });
}

export async function insuranceHistory(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Invalid or expired token" });
  const rows = await prisma.insurance.findMany({ where: { regNo: user.regNo }, orderBy: { id: "desc" } });
  if (!rows.length) return res.json({ status: false, message: "No insurance history found" });
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

export async function cashfreeWebhook(req: AuthenticatedRequest, res: Response) {
  const payload = req.body as Record<string, any>;
  const orderId = payload?.data?.order?.order_id;
  const orderStatus = payload?.data?.order?.order_status;
  const cfPaymentId = payload?.data?.payment?.cf_payment_id ?? null;
  if (!orderId) return res.json({ ok: false });

  const deposit = await prisma.deposit.findFirst({ where: { txn: orderId } });
  if (!deposit) return res.json({ ok: false });
  if (deposit.status === "success") return res.json({ ok: true });

  if (orderStatus === "PAID") {
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "approved", cf_payment_id: cfPaymentId }
    });
    await prisma.bank.create({
      data: { regNo: deposit.regNo, amount: Number(deposit.amount ?? 0), comment: "deposit", txn_type: "credit" }
    });
  } else {
    await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "rejected" } });
  }
  return res.json({ ok: true });
}

