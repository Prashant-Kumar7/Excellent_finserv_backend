import type { Response } from "express";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { prisma } from "../../shared/db.js";

export async function wishlistIndex(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Token invalid" });

  const wishlistRows = await prisma.tenderWishlist.findMany({
    where: { user_id: user.id }
  });
  const tenderIds = wishlistRows.map((w) => w.tender_id).filter((v): v is number => typeof v === "number");
  const tenders = tenderIds.length
    ? await prisma.tender.findMany({ where: { id: { in: tenderIds } } })
    : [];
  const tenderMap = new Map(tenders.map((t) => [t.id, t]));
  const wishlist = wishlistRows.map((w) => ({
    ...w,
    tender: w.tender_id ? tenderMap.get(w.tender_id) ?? null : null
  }));

  return res.json({
    status: true,
    wishlist
  });
}

export async function wishlistAdd(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Token invalid" });

  const { tender_id } = req.body as { tender_id?: number };
  if (!tender_id) {
    return res.status(422).json({ status: false, message: "tender_id is required" });
  }

  const exists = await prisma.tenderWishlist.findFirst({
    where: { user_id: user.id, tender_id }
  });
  if (exists) {
    return res.json({ status: false, message: "Already in wishlist" });
  }

  await prisma.tenderWishlist.create({
    data: { user_id: user.id, tender_id }
  });

  return res.json({ status: true, message: "Added to wishlist" });
}

export async function wishlistRemove(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Token invalid" });

  const { tender_id } = req.body as { tender_id?: number };
  if (!tender_id) {
    return res.status(422).json({ status: false, message: "tender_id is required" });
  }

  await prisma.tenderWishlist.deleteMany({
    where: { user_id: user.id, tender_id }
  });
  return res.json({ status: true, message: "Removed from wishlist" });
}

