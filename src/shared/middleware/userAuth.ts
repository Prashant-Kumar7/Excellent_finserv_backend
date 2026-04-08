import type { NextFunction, Request, Response } from "express";
import { verifyUserToken } from "../auth/jwt.js";
import { prisma } from "../db.js";

type UserRow = {
  id: number;
  mobile: string;
  regNo: string;
  sponser_id?: string | null;
  buyer?: number;
  seller?: number;
};

export type AuthenticatedRequest = Request & {
  user?: UserRow;
};

export async function requireUserAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    if (!token) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: Token missing or invalid"
      });
    }

    const payload = verifyUserToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, mobile: true, regNo: true, sponser_id: true, buyer: true, seller: true }
    });

    if (!user) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const reqUser: UserRow = {
      id: user.id,
      mobile: user.mobile ?? "",
      regNo: user.regNo ?? "",
      sponser_id: user.sponser_id ?? null,
      ...(user.buyer === null || user.buyer === undefined ? {} : { buyer: user.buyer }),
      ...(user.seller === null || user.seller === undefined ? {} : { seller: user.seller })
    };
    req.user = reqUser;
    return next();
  } catch (error) {
    return res.status(401).json({
      status: "error",
      message: "Unauthorized: Token missing or invalid"
    });
  }
}

