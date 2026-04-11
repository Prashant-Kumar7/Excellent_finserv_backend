import jwt from "jsonwebtoken";

export type JwtPayload = {
  sub: number;
  mobile: string;
  regNo: string;
};

/** Minutes; invalid/empty env values must not produce NaN (jwt.sign throws on NaN). */
const DEFAULT_JWT_TTL_MINUTES = 43200;

export function userJwtExpiresInSeconds(): number {
  const raw = process.env.JWT_TTL;
  const trimmed = raw == null ? "" : String(raw).trim();
  const parsed =
    trimmed === "" ? DEFAULT_JWT_TTL_MINUTES : Number.parseInt(trimmed, 10);
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_JWT_TTL_MINUTES;
  return minutes * 60;
}

export function signUserToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const expiresIn = userJwtExpiresInSeconds();
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyUserToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const decoded = jwt.verify(token, secret);
  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }

  const subRaw = (decoded as { sub?: unknown }).sub;
  const sub =
    typeof subRaw === "number" && Number.isFinite(subRaw)
      ? subRaw
      : typeof subRaw === "string" && /^\d+$/.test(subRaw)
        ? Number(subRaw)
        : NaN;
  if (!Number.isFinite(sub) || sub <= 0) {
    throw new Error("Invalid token claims");
  }

  const mobile = (decoded as { mobile?: unknown }).mobile;
  const regNo = (decoded as { regNo?: unknown }).regNo;
  if (typeof mobile !== "string" || typeof regNo !== "string") {
    throw new Error("Invalid token claims");
  }

  return {
    sub,
    mobile,
    regNo
  };
}

