import type { Response } from "express";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { prisma } from "../../shared/db.js";

function paginateParams(pageRaw: unknown, perPage = 10) {
  const page = Number(pageRaw ?? 1);
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const offset = (safePage - 1) * perPage;
  return { page: safePage, perPage, offset };
}

export async function tenderCreateForm(_req: AuthenticatedRequest, res: Response) {
  try {
    const categories = await prisma.category.findMany();
    const states = await prisma.state.findMany();
    const units = await prisma.unit.findMany();

    return res.json({
      status: "done",
      categroy_data: categories,
      state_data: states,
      units
    });
  } catch {
    return res.status(401).json({ status: "error", message: "Token not found" });
  }
}

export async function tenderGetCityByState(req: AuthenticatedRequest, res: Response) {
  const { state } = req.body as { state?: number };
  if (!state || typeof state !== "number") {
    return res.status(422).json({
      status: "error",
      errors: { state: ["State is required."] }
    });
  }
  const cities = await prisma.city.findMany({ where: { state_id: state } });
  return res.json({ status: "done", cities });
}

export async function tenderGetSubcategoryFromCategory(req: AuthenticatedRequest, res: Response) {
  const { category_id } = req.body as { category_id?: number };
  if (!category_id || typeof category_id !== "number") {
    return res.status(422).json({
      status: "error",
      errors: { category_id: ["Category is required."] }
    });
  }
  const subCategories = await prisma.subCategory.findMany({ where: { category_id } });
  return res.json({ status: "done", sub_categories: subCategories });
}

export async function saveTender(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: "error", message: "Token not found" });
  }

  const body = req.body as Record<string, unknown>;
  const requiredFields = [
    "category_id",
    "sub_category_id",
    "state_id",
    "city_id",
    "product_name",
    "tender_name",
    "tender_total",
    "tender_start_date",
    "tender_end_date",
    "expected_product_rate",
    "product_unit_name",
    "tender_validity_date",
    "tender_quantity",
    "tender_type",
    "tender_status"
  ];

  const errors: Record<string, string[]> = {};
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      errors[field] = [`${field} is required.`];
    }
  }
  if (Object.keys(errors).length) {
    return res.status(422).json({ status: "error", errors });
  }

  if (body.tender_status === "pending") {
    const existing = await prisma.tender.findFirst({
      where: { user_id: user.id, tender_status: "pending" }
    });
    if (existing) {
      return res.status(409).json({
        status: "error",
        message: "A pending tender already exists for this user."
      });
    }
  }

  const stateRow = await prisma.state.findUnique({
    where: { id: Number(body.state_id) },
    select: { region_id: true }
  });
  const regionId = stateRow?.region_id ?? null;

  const documentType = typeof body.tender_document_type === "string" ? body.tender_document_type : "unknown";
  const documentPath = typeof body.tender_document === "string" ? body.tender_document : "";

  const created = await prisma.tender.create({
    data: {
      category_id: Number(body.category_id),
      sub_category_id: Number(body.sub_category_id),
      city_id: Number(body.city_id),
      state_id: Number(body.state_id),
      region_id: regionId,
      user_id: user.id,
      tender_type: String(body.tender_type),
      product_name: String(body.product_name),
      tender_name: String(body.tender_name),
      tender_total: Number(body.tender_total),
      tender_start_date: new Date(String(body.tender_start_date)),
      tender_end_date: new Date(String(body.tender_end_date)),
      tender_description: (body.tender_description as string | null | undefined) ?? null,
      expected_product_rate: Number(body.expected_product_rate),
      product_unit_name: String(body.product_unit_name),
      tender_validity_date: new Date(String(body.tender_validity_date)),
      tender_document_type: documentType,
      tender_document: documentPath,
      tender_quantity: Number(body.tender_quantity),
      tender_status: String(body.tender_status)
    }
  });

  return res.json({
    status: "success",
    message: "Tender created successfully.",
    tender: created
  });
}

export async function tenderList(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ status: "error", message: "Token not found" });
  }

  const { user_type } = req.body as { user_type?: string };

  if (user.buyer === 1 && user_type === "buyer") {
    const { page, perPage, offset } = paginateParams(req.query.page);
    const tenders = await prisma.tender.findMany({
      where: { user_id: user.id },
      orderBy: { id: "desc" },
      take: perPage,
      skip: offset
    });
    const totals = await prisma.tender.count({ where: { user_id: user.id } });
    return res.json({
      status: "done",
      user,
      tenders: {
        tenders,
        current_page: page,
        per_page: perPage,
        total: totals
      }
    });
  }

  if (user.seller === 1 && user_type === "seller") {
    const live = await prisma.tender.findMany({
      where: { tender_status: "live" },
      orderBy: { id: "desc" },
      take: 10
    });
    const upcoming = await prisma.tender.findMany({
      where: { tender_status: "upcomming" },
      orderBy: { id: "desc" },
      take: 10
    });
    return res.json({
      status: "done",
      user,
      tenders: {
        tenders: live,
        tenders_upcomming: upcoming
      }
    });
  }

  return res.status(403).json({ status: "error", message: "Unauthorized" });
}

export async function singleTender(req: AuthenticatedRequest, res: Response) {
  const id = Number(req.params.tender_id);
  if (!Number.isFinite(id)) return res.status(400).json({ status: "error" });

  const tender = await prisma.tender.findUnique({ where: { id } });
  if (!tender) {
    return res.status(404).json({ status: "error", message: "Tender not found" });
  }
  const users = tender.user_id ? await prisma.user.findUnique({ where: { id: tender.user_id } }) : null;
  return res.json({
    tenders: tender,
    users
  });
}

