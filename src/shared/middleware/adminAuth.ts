import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { verifyAdminSession } from "../auth/adminSession.js";

type AdminRow = {
  id: number;
  email: string;
};

export type AdminRequest = Request & {
  admin?: AdminRow;
};

export async function requireAdminAuth(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const cookieToken = req.cookies?.admin_token as string | undefined;
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    const token = cookieToken ?? bearer;
    if (!token) {
      return res.status(401).json({ status: "error", message: "Admin unauthorized" });
    }

    const payload = verifyAdminSession(token);
    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
      select: { id: true, email: true }
    });
    if (!admin) {
      return res.status(401).json({ status: "error", message: "Admin unauthorized" });
    }

    req.admin = { id: admin.id, email: admin.email ?? "" };
    return next();
  } catch {
    return res.status(401).json({ status: "error", message: "Admin unauthorized" });
  }
}

