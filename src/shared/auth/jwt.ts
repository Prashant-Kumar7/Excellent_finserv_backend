import jwt from "jsonwebtoken";

export type JwtPayload = {
  sub: number;
  mobile: string;
  regNo: string;
};

export function signUserToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const expiresIn = Number(process.env.JWT_TTL ?? 43200) * 60;
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

