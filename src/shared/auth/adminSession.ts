import jwt from "jsonwebtoken";

export type AdminSessionPayload = {
  adminId: number;
  email: string;
};

function getSecret() {
  return process.env.ADMIN_SESSION_SECRET ?? process.env.JWT_SECRET ?? "admin-session-secret";
}

export function signAdminSession(payload: AdminSessionPayload) {
  return jwt.sign(payload, getSecret(), { expiresIn: "12h" });
}

export function verifyAdminSession(token: string): AdminSessionPayload {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === "string") throw new Error("Invalid admin token");
  if (typeof decoded.adminId !== "number" || typeof decoded.email !== "string") {
    throw new Error("Invalid admin claims");
  }
  return { adminId: decoded.adminId, email: decoded.email };
}

