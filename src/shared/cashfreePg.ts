const CF_API_VERSION = "2025-01-01";

function pgBaseUrl(): string {
  const env = (process.env.CASHFREE_ENV ?? "SANDBOX").toUpperCase();
  return env === "PRODUCTION" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

function sanitizeCustomerId(raw: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (s.length >= 3) return s.slice(0, 50);
  return `cust_${raw.replace(/\D/g, "").slice(-12) || "000"}`.slice(0, 50);
}

/** Indian 10-digit mobile for Cashfree customer_phone */
export function normalizeIndianMobile10(mobile: string): string | null {
  let d = mobile.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10) return null;
  return d;
}

export type CashfreeCreateOrderInput = {
  orderId: string;
  orderAmount: number;
  customerId: string;
  customerPhone10: string;
  customerName?: string | null;
  orderNote?: string;
};

export async function cashfreeCreatePgOrder(input: CashfreeCreateOrderInput): Promise<{
  payment_session_id: string;
  order_id: string;
}> {
  const appId = process.env.CASHFREE_APP_ID;
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!appId || !secret) {
    throw new Error("CASHFREE_APP_ID and CASHFREE_SECRET_KEY must be set");
  }

  const orderAmount = Number(input.orderAmount.toFixed(2));
  if (!Number.isFinite(orderAmount) || orderAmount < 1) {
    throw new Error("order_amount must be >= 1 INR");
  }

  const customerId = sanitizeCustomerId(input.customerId);
  const returnUrl =
    process.env.CASHFREE_RETURN_URL ?? "https://www.cashfree.com/devstudio/thankyou";

  const body: Record<string, unknown> = {
    order_id: input.orderId,
    order_amount: orderAmount,
    order_currency: "INR",
    customer_details: {
      customer_id: customerId,
      customer_phone: input.customerPhone10,
      ...(input.customerName && input.customerName.trim().length >= 3
        ? { customer_name: input.customerName.trim().slice(0, 100) }
        : {})
    },
    order_meta: { return_url: returnUrl },
    order_note: (input.orderNote ?? "Excellent Finserv").slice(0, 200)
  };

  const res = await fetch(`${pgBaseUrl()}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": CF_API_VERSION,
      "x-client-id": appId,
      "x-client-secret": secret
    },
    body: JSON.stringify(body)
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (data.message as string) ||
      (data as { error?: { message?: string } }).error?.message ||
      `Cashfree error ${res.status}`;
    throw new Error(msg);
  }

  const sessionId = data.payment_session_id as string | undefined;
  if (!sessionId) {
    throw new Error("Cashfree did not return payment_session_id");
  }

  return { payment_session_id: sessionId, order_id: String(data.order_id ?? input.orderId) };
}
