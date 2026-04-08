import type { Response } from "express";
import type { AdminRequest } from "../../shared/middleware/adminAuth.js";
import { prisma } from "../../shared/db.js";

export async function adminUsersIndex(req: AdminRequest, res: Response) {
  const name = req.query.name as string | undefined;
  const email = req.query.email as string | undefined;

  const users = await prisma.user.findMany({
    where: {
      ...(name ? { name: { contains: name, mode: "insensitive" } } : {}),
      ...(email ? { email: { contains: email, mode: "insensitive" } } : {})
    },
    orderBy: { id: "desc" }
  });
  return res.json({ status: "done", users });
}

export async function adminUsersShow(req: AdminRequest, res: Response) {
  const id = Number(req.params.user);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ status: "error", message: "User not found" });

  const products = await prisma.product.findMany({ where: { user_id: id }, orderBy: { id: "desc" } });
  return res.json({ status: "done", user, products });
}

export async function adminUsersUpdateStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.user);
  const status = Number((req.body as { status?: number | string }).status);
  if (![1, 2].includes(status)) {
    return res.status(422).json({ status: "error", message: "status must be 1 or 2" });
  }
  await prisma.user.update({ where: { id }, data: { status } });
  return res.json({ status: "done", message: "User status updated successfully" });
}

export async function adminUsersUpdateDetails(req: AdminRequest, res: Response) {
  const id = Number(req.params.user);
  const body = req.body as Record<string, unknown>;
  const editable = ["name", "last_name", "email", "mobile", "companyName", "companyNumber", "area", "gst_number"];
  const data: Record<string, unknown> = {};
  for (const field of editable) {
    if (field in body) {
      data[field] = body[field];
    }
  }
  if (!Object.keys(data).length) return res.status(422).json({ status: "error", message: "No details provided" });
  await prisma.user.update({ where: { id }, data });
  return res.json({ status: "done", message: "User details updated successfully" });
}

export async function adminUsersUpdateKycStatus(req: AdminRequest, res: Response) {
  const id = Number(req.params.user);
  const kycStatus = Number((req.body as { kyc_status?: number | string }).kyc_status);
  if (![1, 2].includes(kycStatus)) {
    return res.status(422).json({ status: "error", message: "kyc_status must be 1 or 2" });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, seller: true }
  });
  if (!user) return res.status(404).json({ status: "error", message: "User not found" });
  if (Number(user.seller ?? 0) !== 1) {
    return res.status(400).json({ status: "error", message: "KYC update only allowed for sellers" });
  }

  await prisma.user.update({ where: { id }, data: { kyc_status: kycStatus } });
  return res.json({
    status: "done",
    message: kycStatus === 1 ? "KYC accepted successfully" : "KYC rejected successfully"
  });
}

