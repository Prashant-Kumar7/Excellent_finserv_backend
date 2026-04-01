import type { Response } from "express";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { prisma } from "../../shared/db.js";

export async function interestIndex(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Token invalid" });

  const interestRows = await prisma.tenderInterest.findMany({
    where: { user_id: user.id }
  });
  const tenderIds = interestRows.map((i) => i.tender_id).filter((v): v is number => typeof v === "number");
  const tenders = tenderIds.length
    ? await prisma.tender.findMany({ where: { id: { in: tenderIds } } })
    : [];
  const tenderMap = new Map(tenders.map((t) => [t.id, t]));
  const interests = interestRows.map((i) => ({
    ...i,
    tender: i.tender_id ? tenderMap.get(i.tender_id) ?? null : null
  }));

  return res.json({
    status: true,
    interests
  });
}

export async function interestSubmit(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: false, message: "Token invalid" });

  const { tender_id, message = null } = req.body as { tender_id?: number; message?: string };
  if (!tender_id) {
    return res.status(422).json({ status: false, message: "tender_id is required" });
  }

  const exists = await prisma.tenderInterest.findFirst({
    where: { user_id: user.id, tender_id }
  });
  if (exists) {
    return res.json({ status: false, message: "Already submitted interest" });
  }

  await prisma.tenderInterest.create({
    data: { user_id: user.id, tender_id, message }
  });

  return res.json({ status: true, message: "Interest submitted" });
}

