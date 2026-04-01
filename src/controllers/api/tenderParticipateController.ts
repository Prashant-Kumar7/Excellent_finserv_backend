import type { Response } from "express";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { prisma } from "../../shared/db.js";

export async function participateStore(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: "error", message: "Token invalid" });

  const body = req.body as Record<string, unknown>;
  const required = ["tender_id", "order_id", "payment_id", "payment_mode"];
  const errors: Record<string, string[]> = {};
  for (const field of required) {
    if (!body[field]) errors[field] = [`${field} is required.`];
  }
  if (Object.keys(errors).length) {
    return res.status(422).json({ status: "error", message: errors });
  }

  const tenderId = Number(body.tender_id);
  if (!Number.isFinite(tenderId)) {
    return res.status(422).json({ status: "error", message: { tender_id: ["Invalid tender_id"] } });
  }

  const existingOrder = await prisma.tenderParticipate.findFirst({
    where: { order_id: String(body.order_id) },
    select: { id: true }
  });
  if (existingOrder) {
    return res
      .status(422)
      .json({ status: "error", message: { order_id: ["This Order ID has already been taken."] } });
  }
  const existingPayment = await prisma.tenderParticipate.findFirst({
    where: { payment_id: String(body.payment_id) },
    select: { id: true }
  });
  if (existingPayment) {
    return res
      .status(422)
      .json({ status: "error", message: { payment_id: ["This Payment ID has already been used."] } });
  }

  const created = await prisma.tenderParticipate.create({
    data: {
      user_id: user.id,
      tender_id: tenderId,
      dispatched_location: (body.dispatched_location as string | null) ?? null,
      paid_emd: body.paid_emd ? Number(body.paid_emd) : null,
      unit_name: (body.unit_name as string | null) ?? null,
      offer_price: body.offer_price ? Number(body.offer_price) : null,
      offer_quantity: body.offer_quantity ? Number(body.offer_quantity) : null,
      delivery_period: (body.delivery_period as string | null) ?? null,
      company_brochure_document: (body.company_brochure_document as string | null) ?? null,
      technical_specification_document: (body.technical_specification_document as string | null) ?? null,
      mode_of_transport: (body.mode_of_transport as string | null) ?? null,
      remarks: (body.remarks as string | null) ?? null,
      payment_mode: String(body.payment_mode),
      order_id: String(body.order_id),
      payment_id: String(body.payment_id)
    }
  });

  return res.json({ status: "success", data: created });
}

export async function participateList(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: "error", message: "Token invalid" });

  const page = Number(req.query.page ?? 1);
  const perPage = 10;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const offset = (safePage - 1) * perPage;

  const [data, total] = await Promise.all([
    prisma.tenderParticipate.findMany({
      where: { user_id: user.id },
      orderBy: { id: "desc" },
      take: perPage,
      skip: offset
    }),
    prisma.tenderParticipate.count({ where: { user_id: user.id } })
  ]);

  return res.json({
    status: "success",
    data: {
      data,
      current_page: safePage,
      per_page: perPage,
      total
    }
  });
}

export async function participateSingle(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const id = Number(req.params.myid);
  if (!user || !Number.isFinite(id)) {
    return res.status(401).json({ status: "error", message: "Token invalid" });
  }

  const row = await prisma.tenderParticipate.findFirst({
    where: { user_id: user.id, id }
  });
  return res.json({ status: "success", data: row ?? null });
}

