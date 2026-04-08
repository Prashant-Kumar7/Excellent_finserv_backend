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

  if (
    typeof decoded.sub !== "number" ||
    typeof decoded.mobile !== "string" ||
    typeof decoded.regNo !== "string"
  ) {
    throw new Error("Invalid token claims");
  }

  return {
    sub: decoded.sub,
    mobile: decoded.mobile,
    regNo: decoded.regNo
  };
}

