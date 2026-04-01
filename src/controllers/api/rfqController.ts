import type { Response } from "express";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { prisma } from "../../shared/db.js";

export async function addRFQ(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user || user.buyer !== 1) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  const { description = null, mrp, product_id, state_id, city_id, unit_name, delivery_date } = req.body as Record<
    string,
    unknown
  >;
  if (!mrp || !product_id || !state_id || !city_id || !unit_name || !delivery_date) {
    return res.status(422).json({ status: "error", message: "Validation failed" });
  }

  const product = await prisma.product.findUnique({
    where: { id: Number(product_id) },
    select: { user_id: true }
  });
  if (!product) return res.status(404).json({ status: "error", message: "Product not found" });

  const state = await prisma.state.findUnique({
    where: { id: Number(state_id) },
    select: { region_id: true }
  });
  if (!state) return res.status(404).json({ status: "error", message: "State not found" });

  const created = await prisma.rFQ.create({
    data: {
      description: (description as string | null) ?? null,
      mrp: Number(mrp),
      buyer_id: user.id,
      seller_id: Number(product.user_id ?? 0),
      region_id: Number(state.region_id ?? 0),
      state_id: Number(state_id),
      city_id: Number(city_id),
      product_id: Number(product_id),
      unit_name: String(unit_name),
      delivery_date: String(delivery_date)
    }
  });

  return res.json({ status: "done", message: "RFQ created successfully!", data: created });
}

export async function deleteRFQ(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const id = Number(req.params.id);
  if (!user || !Number.isFinite(id)) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  const rfq = await prisma.rFQ.findUnique({
    where: { id },
    select: { id: true, buyer_id: true, seller_id: true }
  });
  if (!rfq) return res.status(404).json({ status: "error", message: "RFQ not found" });
  if (Number(rfq.buyer_id ?? 0) !== user.id) {
    return res
      .status(403)
      .json({ status: "error", message: "You are not authorized to delete this RFQ." });
  }

  await prisma.rFQ.delete({ where: { id } });
  return res.json({ status: "done", message: "RFQ deleted successfully!" });
}

export async function getSingleRFQ(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const id = Number(req.params.id);
  if (!user || !Number.isFinite(id)) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  const rfq = await prisma.rFQ.findUnique({ where: { id } });
  if (!rfq) return res.status(404).json({ status: "error", message: "RFQ not found" });

  if (Number(rfq.buyer_id ?? 0) !== user.id && Number(rfq.seller_id ?? 0) !== user.id) {
    return res.status(403).json({
      status: "error",
      message: "You are not authorized to view this RFQ."
    });
  }

  return res.json({
    status: "done",
    message: "RFQ details fetched successfully!",
    data: rfq
  });
}

export async function listRFQs(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ status: "error", message: "Unauthorized" });

  const page = Number(req.query.page ?? 1);
  const perPage = 10;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const offset = (safePage - 1) * perPage;

  const [data, total] = await Promise.all([
    prisma.rFQ.findMany({
      where: { OR: [{ buyer_id: user.id }, { seller_id: user.id }] },
      orderBy: { created_at: "desc" },
      take: perPage,
      skip: offset
    }),
    prisma.rFQ.count({ where: { OR: [{ buyer_id: user.id }, { seller_id: user.id }] } })
  ]);

  return res.json({
    status: "done",
    message: "RFQs fetched successfully!",
    data: {
      data,
      current_page: safePage,
      per_page: perPage,
      total
    }
  });
}

