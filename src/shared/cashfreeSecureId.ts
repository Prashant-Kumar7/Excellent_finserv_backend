import crypto from "node:crypto";

const CF_VRS_API_VERSION = "2023-12-18";

function verificationBaseUrl(): string {
  const env = (process.env.CASHFREE_ENV ?? "SANDBOX").toUpperCase();
  return env === "PRODUCTION"
    ? "https://api.cashfree.com/verification"
    : "https://sandbox.cashfree.com/verification";
}

function verificationCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.CASHFREE_VRS_CLIENT_ID ?? process.env.CASHFREE_APP_ID ?? "";
  const clientSecret = process.env.CASHFREE_VRS_CLIENT_SECRET ?? process.env.CASHFREE_SECRET_KEY ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("Cashfree verification credentials are missing");
  }
  return { clientId, clientSecret };
}

type FetchMethod = "GET" | "POST";

async function vrsRequest<T>(
  method: FetchMethod,
  path: string,
  opts?: { body?: Record<string, unknown>; query?: URLSearchParams }
): Promise<T> {
  const { clientId, clientSecret } = verificationCreds();
  const qs = opts?.query ? `?${opts.query.toString()}` : "";
  const url = `${verificationBaseUrl()}${path}${qs}`;
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-api-version": CF_VRS_API_VERSION,
      "x-client-id": clientId,
      "x-client-secret": clientSecret
    },
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {})
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = String(data.message ?? data.code ?? `Cashfree verification error ${res.status}`);
    throw new Error(msg);
  }
  return data as T;
}

export type DigilockerCreateResponse = {
  verification_id: string;
  reference_id: number;
  url: string;
  status: string;
  user_flow?: string;
  document_requested?: string[];
  redirect_url?: string;
};

export async function createDigilockerUrl(input: {
  verificationId: string;
  documents: Array<"AADHAAR" | "PAN" | "DRIVING_LICENSE">;
  userFlow?: "signin" | "signup";
  redirectUrl?: string;
}) {
  return vrsRequest<DigilockerCreateResponse>("POST", "/digilocker", {
    body: {
      verification_id: input.verificationId,
      document_requested: input.documents,
      ...(input.userFlow ? { user_flow: input.userFlow } : {}),
      ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {})
    }
  });
}

export async function getDigilockerStatus(input: { verificationId?: string; referenceId?: string }) {
  const query = new URLSearchParams();
  if (input.verificationId) query.set("verification_id", input.verificationId);
  if (input.referenceId) query.set("reference_id", input.referenceId);
  return vrsRequest<Record<string, unknown>>("GET", "/digilocker", { query });
}

export async function getDigilockerDocument(input: {
  documentType: "AADHAAR" | "PAN" | "DRIVING_LICENSE";
  verificationId?: string;
  referenceId?: string;
}) {
  const query = new URLSearchParams();
  if (input.verificationId) query.set("verification_id", input.verificationId);
  if (input.referenceId) query.set("reference_id", input.referenceId);
  return vrsRequest<Record<string, unknown>>("GET", `/digilocker/document/${input.documentType}`, { query });
}

export async function createReversePennyDrop(input: { verificationId: string; name?: string }) {
  return vrsRequest<Record<string, unknown>>("POST", "/reverse-penny-drop", {
    body: {
      verification_id: input.verificationId,
      ...(input.name ? { name: input.name } : {})
    }
  });
}

export async function getReversePennyDropStatus(input: { verificationId?: string; refId?: string }) {
  const query = new URLSearchParams();
  if (input.verificationId) query.set("verification_id", input.verificationId);
  if (input.refId) query.set("ref_id", input.refId);
  return vrsRequest<Record<string, unknown>>("GET", "/remitter/status", { query });
}

export function verifySecureIdWebhookSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = process.env.CASHFREE_SECUREID_WEBHOOK_SECRET ?? "";
  if (!secret) return true;
  const signedPayload = `${timestamp}${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
