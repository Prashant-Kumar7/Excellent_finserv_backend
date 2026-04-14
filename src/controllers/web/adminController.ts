import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db.js";
import type { AdminRequest } from "../../shared/middleware/adminAuth.js";
import { signAdminSession } from "../../shared/auth/adminSession.js";

type AdminRow = {
  id: number;
  email: string;
  password: string;
};

type UserRow = {
  regNo: string;
  sponser_id: string | null;
};

function mlmPercentage(level: number, amount: number) {
  const percentages: Record<number, number> = {
    1: 0.1,
    2: 0.1,
    3: 0.08,
    4: 0.08,
    5: 0.06,
    6: 0.06,
    7: 0.04,
    8: 0.02,
    9: 0.02,
    10: 0.01,
    11: 0.005,
    12: 0.005
  };
  return amount * (percentages[level] ?? 0);
}

async function levelMlmInTx(tx: Prisma.TransactionClient, regNo: string, amount: number, sourceId: number) {
  let currentRegNo = regNo;
  for (let level = 1; level <= 12; level += 1) {
    const user = await tx.user.findFirst({
      where: { regNo: currentRegNo },
      select: { regNo: true, sponser_id: true }
    });
    if (!user?.sponser_id) break;

    const sponsorRegNo = String(user.sponser_id);
    const eligible = await tx.perday.findFirst({
      where: { regNo: sponsorRegNo },
      select: { id: true }
    });

    if (eligible) {
      try {
        await tx.wallet.create({
          data: {
            regNo: sponsorRegNo,
            amount: mlmPercentage(level, amount),
            level,
            source_id: sourceId,
            comment: "level_income"
          }
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") {
          throw e;
        }
      }
    }
    currentRegNo = sponsorRegNo;
  }
}

export async function adminLogin(_req: Request, res: Response) {
  return res.json({ status: "ok", message: "Admin login endpoint" });
}

export async function adminLoginSubmit(req: Request, res: Response) {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(422).json({ status: "error", message: "email and password required" });
  }
  const admin = await prisma.admin.findFirst({
    where: { email },
    select: { id: true, email: true, password: true }
  });
  if (!admin) return res.status(401).json({ status: "error", message: "Invalid email or password." });

  const ok = await bcrypt.compare(password, admin.password ?? "");
  if (!ok) return res.status(401).json({ status: "error", message: "Invalid email or password." });

  const token = signAdminSession({ adminId: admin.id, email: admin.email ?? email });
  res.cookie("admin_token", token, { httpOnly: true, sameSite: "lax" });
  return res.json({ status: "done", token });
}

export async function adminDashboard(_req: AdminRequest, res: Response) {
  const [totalUsers, totalCategory, totalTender, totalProducts] = await Promise.all([
    prisma.user.count(),
    prisma.category.count(),
    prisma.tender.count(),
    prisma.product.count()
  ]);
  return res.json({
    totalUsers,
    totalCategory,
    totalTender,
    totalProducts
  });
}

export async function adminLogout(req: Request, res: Response) {
  res.clearCookie("admin_token");
  return res.json({ status: "done", message: "Logout successful." });
}

export async function depositList(req: AdminRequest, res: Response) {
  const status = req.params.status;
  if (!status) return res.status(422).json({ status: "error", message: "status is required" });
  const deposits = await prisma.deposit.findMany({
    where: { status },
    orderBy: { created_at: "desc" }
  });

  const regNos = deposits.map((d) => d.regNo).filter((v): v is string => typeof v === "string");
  const users = regNos.length ? await prisma.user.findMany({ where: { regNo: { in: regNos } } }) : [];
  const userMap = new Map(users.map((u) => [u.regNo ?? "", u]));

  const data = deposits.map((d) => {
    const u = userMap.get(d.regNo ?? "");
    return {
      ...d,
      name: u?.name ?? null,
      user_mobile: u?.mobile ?? null
    };
  });

  return res.json({ status: "done", data });
}

export async function updateDepositStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const status = (req.body as { status?: string }).status;
  if (!Number.isFinite(id) || !status) {
    return res.status(422).json({ status: "error", message: "Invalid input" });
  }
  const deposit = await prisma.deposit.findUnique({ where: { id } });
  if (!deposit) return res.status(404).json({ status: "error", message: "Deposit not found" });
  if (status === "approved") {
    if (!deposit.regNo) {
      return res.status(400).json({ status: "error", message: "deposit.regNo missing" });
    }
    await prisma.$transaction(async (tx) => {
      const updated = await tx.deposit.updateMany({
        where: { id, NOT: { status: "approved" } },
        data: { status, updated_at: new Date() }
      });
      if (updated.count !== 1) return;
      await tx.bank.create({
        data: {
          regNo: deposit.regNo,
          amount: Number(deposit.amount ?? 0),
          comment: `Deposit Approved ID ${id}`,
          txn_type: "credit"
        }
      });
    });
  } else {
    await prisma.deposit.update({
      where: { id },
      data: { status, updated_at: new Date() }
    });
  }
  return res.json({ status: "done", message: "Status Updated" });
}

export async function packagePurchaseList(req: AdminRequest, res: Response) {
  const status = req.params.status;
  if (!status) return res.status(422).json({ status: "error", message: "status is required" });
  const purchases = await prisma.package.findMany({
    where: { status },
    orderBy: { id: "desc" }
  });
  const regNos = purchases.map((p) => p.regNo).filter((v): v is string => typeof v === "string");
  const users = regNos.length ? await prisma.user.findMany({ where: { regNo: { in: regNos } } }) : [];
  const userMap = new Map(users.map((u) => [u.regNo ?? "", u]));

  const data = purchases.map((p) => ({
    ...p,
    user_name: userMap.get(p.regNo ?? "")?.name ?? null
  }));
  return res.json({ status: "done", data });
}

export async function updatePackagePurchaseStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const status = (req.body as { status?: string }).status;
  if (!Number.isFinite(id) || !status) {
    return res.status(422).json({ status: "error", message: "Invalid input" });
  }
  const purchase = await prisma.package.findUnique({ where: { id } });
  if (!purchase) return res.status(404).json({ status: "error", message: "Record not found" });

  if (status === "rejected") {
    const updated = await prisma.package.updateMany({ where: { id, status: "pending" }, data: { status: "rejected" } });
    if (updated.count !== 1) {
      return res.status(400).json({ status: "error", message: "Only pending can be rejected" });
    }
    return res.json({ status: "done", message: "Status rejected successfully" });
  }

  if (status === "approved") {
    if (purchase.status !== "pending") {
      return res.status(400).json({ status: "error", message: "Only pending can be approved" });
    }
    if (!purchase.regNo) return res.status(400).json({ status: "error", message: "purchase.regNo missing" });
    const purchaseRegNo = purchase.regNo;
    const purchaseAmount = Number(purchase.amount ?? 0);
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.package.updateMany({
          where: { id, status: "pending" },
          data: { status: "approved" }
        });
        if (updated.count !== 1) throw new Error("Only pending can be approved");
        await tx.perday.create({
          data: { regNo: purchaseRegNo, amount: purchaseAmount }
        });
        await levelMlmInTx(tx, purchaseRegNo, purchaseAmount, id);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Approval failed";
      const code = msg === "Only pending can be approved" ? 400 : 422;
      return res.status(code).json({ status: "error", message: msg });
    }
    return res.json({ status: "done", message: "Approved & perday entry added" });
  }

  return res.status(400).json({ status: "error", message: "Invalid status" });
}

export async function incomeWithdrawList(req: AdminRequest, res: Response) {
  const status = req.params.status;
  if (!status) return res.status(422).json({ status: "error", message: "status is required" });
  const rows = await prisma.wallet.findMany({
    where: { status },
    orderBy: { id: "desc" }
  });

  const regNos = rows.map((r) => r.regNo).filter((v): v is string => typeof v === "string");
  const users = regNos.length ? await prisma.user.findMany({ where: { regNo: { in: regNos } } }) : [];
  const userMap = new Map(users.map((u) => [u.regNo ?? "", u]));

  const data = rows.map((r) => {
    const u = userMap.get(r.regNo ?? "");
    return {
      ...r,
      user_name: u?.name ?? null,
      bank_name: (u as any)?.bank_name ?? null,
      ifsc: (u as any)?.ifsc ?? null,
      upi_id: (u as any)?.upi_id ?? null,
      account_number: (u as any)?.account_number ?? null
    };
  });

  return res.json({ status: "done", data });
}

export async function walletWithdrawList(req: AdminRequest, res: Response) {
  const status = req.params.status;
  if (!status) return res.status(422).json({ status: "error", message: "status is required" });
  const rows = await prisma.bank.findMany({
    where: { status },
    orderBy: { id: "desc" }
  });

  const regNos = rows.map((r) => r.regNo).filter((v): v is string => typeof v === "string");
  const users = regNos.length ? await prisma.user.findMany({ where: { regNo: { in: regNos } } }) : [];
  const userMap = new Map(users.map((u) => [u.regNo ?? "", u]));

  const data = rows.map((r) => {
    const u = userMap.get(r.regNo ?? "");
    return {
      ...r,
      user_name: u?.name ?? null,
      bank_name: (u as any)?.bank_name ?? null,
      ifsc: (u as any)?.ifsc ?? null,
      upi_id: (u as any)?.upi_id ?? null,
      account_number: (u as any)?.account_number ?? null
    };
  });

  return res.json({ status: "done", data });
}

export async function updateIncomeWithdrawStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const status = (req.body as { status?: string }).status;
  if (!status || !Number.isFinite(id)) {
    return res.status(422).json({ status: "error", message: "Invalid input" });
  }
  const row = await prisma.wallet.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ status: "error", message: "Record not found" });
  if (row.status !== "pending") return res.status(400).json({ status: "error", message: "Already processed" });
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.updateMany({ where: { id, status: "pending" }, data: { status } });
      if (updated.count !== 1) throw new Error("Already processed");
      if (status === "rejected") {
        if (!row.regNo) throw new Error("wallet.regNo missing");
        await tx.wallet.create({
          data: { regNo: row.regNo, amount: -1 * Number(row.amount ?? 0), comment: "cancel_withdraw_return" }
        });
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status update failed";
    const code = msg === "Already processed" ? 400 : 422;
    return res.status(code).json({ status: "error", message: msg });
  }
  return res.json({ status: "done", message: "Status updated successfully" });
}

export async function updateWalletWithdrawStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const status = (req.body as { status?: string }).status;
  if (!status || !Number.isFinite(id)) {
    return res.status(422).json({ status: "error", message: "Invalid input" });
  }
  const row = await prisma.bank.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ status: "error", message: "Record not found" });
  if (row.status !== "pending") return res.status(400).json({ status: "error", message: "Already processed" });
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.bank.updateMany({
        where: { id, status: "pending" },
        data: { status, updated_at: new Date() }
      });
      if (updated.count !== 1) throw new Error("Already processed");
      if (status === "rejected") {
        if (!row.regNo) throw new Error("bank.regNo missing");
        await tx.bank.create({
          data: {
            regNo: row.regNo,
            amount: -1 * Number(row.amount ?? 0),
            comment: "Withdraw rejected refund"
          }
        });
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status update failed";
    const code = msg === "Already processed" ? 400 : 422;
    return res.status(code).json({ status: "error", message: msg });
  }
  return res.json({ status: "done", message: "Status updated successfully" });
}

export async function insuranceList(req: AdminRequest, res: Response) {
  const status = req.params.status;
  if (!status) return res.status(422).json({ status: "error", message: "status is required" });
  const rows = await prisma.insurance.findMany({
    where: { status },
    orderBy: { id: "desc" }
  });
  const regNos = rows.map((r) => r.regNo).filter((v): v is string => typeof v === "string");
  const users = regNos.length ? await prisma.user.findMany({ where: { regNo: { in: regNos } } }) : [];
  const userMap = new Map(users.map((u) => [u.regNo ?? "", u]));
  const data = rows.map((r) => {
    const u = userMap.get(r.regNo ?? "");
    return { ...r, user_name: u?.name ?? null, user_mobile: u?.mobile ?? null };
  });
  return res.json({ status: "done", data });
}

export async function cibileList(req: AdminRequest, res: Response) {
  const status = req.params.status;
  if (!status) return res.status(422).json({ status: "error", message: "status is required" });
  const rows = await prisma.cibileReportRequest.findMany({
    where: { status },
    orderBy: { id: "desc" }
  });
  const regNos = rows.map((r) => r.regNo).filter((v): v is string => typeof v === "string");
  const users = regNos.length ? await prisma.user.findMany({ where: { regNo: { in: regNos } } }) : [];
  const userMap = new Map(users.map((u) => [u.regNo ?? "", u]));
  const data = rows.map((r) => {
    const u = userMap.get(r.regNo ?? "");
    return { ...r, user_name: u?.name ?? null, user_mobile: u?.mobile ?? null };
  });
  return res.json({ status: "done", data });
}

export async function loanList(req: AdminRequest, res: Response) {
  const status = req.params.status;
  if (!status) return res.status(422).json({ status: "error", message: "status is required" });
  const rows = await prisma.loan.findMany({
    where: { status },
    orderBy: { id: "desc" }
  });
  const regNos = rows.map((r) => r.regNo).filter((v): v is string => typeof v === "string");
  const users = regNos.length ? await prisma.user.findMany({ where: { regNo: { in: regNos } } }) : [];
  const userMap = new Map(users.map((u) => [u.regNo ?? "", u]));
  const data = rows.map((r) => {
    const u = userMap.get(r.regNo ?? "");
    return { ...r, user_name: u?.name ?? null, user_mobile: u?.mobile ?? null };
  });
  return res.json({ status: "done", data });
}

export async function loanEdit(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const loan = await prisma.loan.findUnique({ where: { id } });
  return res.json({ status: "done", data: loan ?? null });
}

export async function loanUpdate(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if ("status" in body) data.status = body.status;
  if ("amount" in body) data.amount = body.amount ? Number(body.amount) : 0;
  if ("remarks" in body) data.remarks = body.remarks as string | null;
  if ("application_id" in body) data.application_id = body.application_id as string | null;
  if ("bank_or_nbfc" in body) data.bank_or_nbfc = body.bank_or_nbfc as string | null;
  if ("login_date" in body && body.login_date) data.login_date = new Date(String(body.login_date));
  if ("approved_amount" in body && body.approved_amount !== undefined && body.approved_amount !== "")
    data.approved_amount = Number(body.approved_amount);
  if ("disbursed_amount" in body && body.disbursed_amount !== undefined && body.disbursed_amount !== "")
    data.disbursed_amount = Number(body.disbursed_amount);
  if ("total_incentive" in body && body.total_incentive !== undefined && body.total_incentive !== "")
    data.total_incentive = Number(body.total_incentive);
  if ("loan_type" in body) data.loan_type = body.loan_type as string | null;
  if (!Object.keys(data).length) return res.status(422).json({ status: "error", message: "No fields to update" });
  data.updated_at = new Date();
  await prisma.loan.update({ where: { id }, data: data as any });
  return res.json({ status: "done", message: "Loan updated" });
}

export async function updateLoanStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const status = (req.body as { status?: string }).status;
  if (!status || !Number.isFinite(id)) {
    return res.status(422).json({ status: "error", message: "Invalid input" });
  }
  const row = await prisma.loan.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!row) return res.status(404).json({ status: "error", message: "Record not found" });
  if (row.status !== "pending") {
    return res.status(400).json({ status: "error", message: "Only pending records can be updated" });
  }
  if (!["approved", "rejected"].includes(status)) {
    return res.status(422).json({ status: "error", message: "Status must be approved or rejected" });
  }
  const updated = await prisma.loan.updateMany({ where: { id, status: "pending" }, data: { status } });
  if (updated.count !== 1) {
    return res.status(400).json({ status: "error", message: "Already processed" });
  }
  return res.json({ status: "done", message: "Status updated successfully" });
}

export async function updateCibileStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const status = (req.body as { status?: string }).status;
  if (!status || !Number.isFinite(id)) {
    return res.status(422).json({ status: "error", message: "Invalid input" });
  }
  const row = await prisma.cibileReportRequest.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!row) return res.status(404).json({ status: "error", message: "Record not found" });
  if (row.status !== "pending") {
    return res.status(400).json({ status: "error", message: "Only pending records can be updated" });
  }
  if (!["approved", "rejected"].includes(status)) {
    return res.status(422).json({ status: "error", message: "Status must be approved or rejected" });
  }
  const updated = await prisma.cibileReportRequest.updateMany({ where: { id, status: "pending" }, data: { status } });
  if (updated.count !== 1) {
    return res.status(400).json({ status: "error", message: "Already processed" });
  }
  return res.json({ status: "done", message: "Status updated successfully" });
}

export async function updateInsuranceStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.id);
  const status = (req.body as { status?: string }).status;
  if (!status || !Number.isFinite(id)) {
    return res.status(422).json({ status: "error", message: "Invalid input" });
  }
  const row = await prisma.insurance.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!row) return res.status(404).json({ status: "error", message: "Record not found" });
  if (row.status !== "pending") {
    return res.status(400).json({ status: "error", message: "Only pending records can be updated" });
  }
  if (!["approved", "rejected"].includes(status)) {
    return res.status(422).json({ status: "error", message: "Status must be approved or rejected" });
  }
  const updated = await prisma.insurance.updateMany({ where: { id, status: "pending" }, data: { status } });
  if (updated.count !== 1) {
    return res.status(400).json({ status: "error", message: "Already processed" });
  }
  return res.json({ status: "done", message: "Status updated successfully" });
}

