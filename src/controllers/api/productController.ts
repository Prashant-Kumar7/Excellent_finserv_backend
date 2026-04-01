import type { Response } from "express";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { prisma } from "../../shared/db.js";

function parsePage(pageValue: unknown) {
  const page = Number(pageValue ?? 1);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

export async function listProducts(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const userType = req.params.user_type;
  if (!user) return res.status(401).json({ status: "error" });

  const page = parsePage(req.query.page);
  const limit = 10;
  const offset = (page - 1) * limit;

  if (user.seller === 1 && userType === "seller") {
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where: { user_id: user.id },
        orderBy: { id: "desc" },
        take: limit,
        skip: offset
      }),
      prisma.product.count({ where: { user_id: user.id } })
    ]);
    return res.json({
      status: "success",
      data: { data: rows, current_page: page, per_page: limit, total }
    });
  }

  if (user.buyer === 1 && userType === "buyer") {
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where: { status: "live" },
        orderBy: { id: "desc" },
        take: limit,
        skip: offset
      }),
      prisma.product.count({ where: { status: "live" } })
    ]);
    return res.json({
      status: "success",
      data: { data: rows, current_page: page, per_page: limit, total }
    });
  }

  return res.status(403).json({ status: "error" });
}

export async function showProduct(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const userType = req.params.user_type;
  const id = Number(req.params.id);
  if (!user || !Number.isFinite(id)) return res.status(400).json({ status: "error" });

  if (user.seller === 1 && userType === "seller") {
    const product = await prisma.product.findFirst({ where: { user_id: user.id, id } });
    if (!product) return res.status(404).json({ status: "error" });
    return res.json({ status: "success", data: product });
  }

  if (user.buyer === 1 && userType === "buyer") {
    const product = await prisma.product.findFirst({ where: { id, status: "live" } });
    if (!product) {
      return res.status(404).json({ status: "error", message: "Product not found or not live." });
    }
    const seller = await prisma.user.findFirst({ where: { id: Number(product.user_id ?? 0) } });
    return res.json({
      status: "success",
      data: product,
      seller_data: seller
    });
  }

  return res.status(403).json({ status: "error" });
}

export async function createProduct(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  if (!user || user.seller !== 1) {
    return res.status(403).json({ status: "error", message: "User must be seller" });
  }

  const {
    product_name,
    description,
    stock,
    mrp,
    specifications = null,
    packaging_details = null,
    moq = null,
    payment_terms = null,
    delivery_info = null,
    certifications = null,
    category_id,
    sub_category_id,
    images = null,
    video = null
  } = req.body as Record<string, unknown>;

  if (
    !product_name ||
    !description ||
    stock === undefined ||
    mrp === undefined ||
    !category_id ||
    !sub_category_id
  ) {
    return res.status(422).json({ status: "error", errors: { message: "Validation failed" } });
  }

  const data: Record<string, unknown> = {
      product_name: String(product_name),
      description: String(description),
      stock: Number(stock),
      mrp: Number(mrp),
      specifications: (specifications as string | null) ?? null,
      packaging_details: (packaging_details as string | null) ?? null,
      moq: (moq as string | null) ?? null,
      payment_terms: (payment_terms as string | null) ?? null,
      delivery_info: (delivery_info as string | null) ?? null,
      certifications: certifications ? JSON.stringify(certifications) : null,
      category_id: Number(category_id),
      sub_category_id: Number(sub_category_id),
      video: (video as string | null) ?? null,
      user_id: user.id
  };
  if (images !== null) data.images = images as object;
  const product = await prisma.product.create({ data });

  return res.status(201).json({
    message: "Product created successfully",
    product,
    status: "done"
  });
}

export async function updateProduct(req: AuthenticatedRequest, res: Response) {
  const user = req.user;
  const id = Number(req.params.id);
  if (!user || !Number.isFinite(id)) return res.status(400).json({ status: "error" });

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).json({ status: "error", message: "Product not found" });

  if (user.seller !== 1 || Number(product.user_id ?? 0) !== user.id) {
    return res.status(403).json({ message: "User must be seller", status: "error" });
  }

  const fields = [
    "product_name",
    "description",
    "stock",
    "mrp",
    "specifications",
    "packaging_details",
    "moq",
    "payment_terms",
    "delivery_info",
    "category_id",
    "sub_category_id",
    "video"
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of fields) {
    if (key in req.body) {
      data[key] = (req.body as Record<string, unknown>)[key];
    }
  }
  if ("images" in (req.body as Record<string, unknown>)) {
    data.images = (req.body as Record<string, unknown>).images;
  }
  if ("certifications" in (req.body as Record<string, unknown>)) {
    data.certifications = JSON.stringify((req.body as Record<string, unknown>).certifications);
  }

  if (!Object.keys(data).length) {
    return res.status(422).json({ status: "error", errors: { message: "No fields to update" } });
  }

  const updated = await prisma.product.update({ where: { id }, data });
  return res.json({ message: "Product updated successfully", product: updated, status: "done" });
}

export async function deleteProduct(req: AuthenticatedRequest, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ status: "error" });

  const exists = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: "Product not found", status: "error" });
  await prisma.product.delete({ where: { id } });
  return res.json({ message: "Product deleted successfully", status: "done" });
}

