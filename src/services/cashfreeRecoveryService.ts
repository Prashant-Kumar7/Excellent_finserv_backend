import { prisma } from "../shared/db.js";
import { cashfreeGetPgOrderStatus } from "../shared/cashfreePg.js";

const RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
const STALE_PROCESSING_MS_NO_PAYMENT_ID = 60 * 60 * 1000;
const STALE_PROCESSING_MS_WITH_PAYMENT_ID = 4 * 60 * 60 * 1000;

async function recoverStaleCashfreeProcessingOrders(): Promise<void> {
  const now = Date.now();
  const staleNoPid = new Date(now - STALE_PROCESSING_MS_NO_PAYMENT_ID);
  const staleWithPid = new Date(now - STALE_PROCESSING_MS_WITH_PAYMENT_ID);

  const rows = await prisma.cashfreeOrder.findMany({
    where: {
      status: "processing",
      OR: [
        { cf_payment_id: null, updated_at: { lte: staleNoPid } },
        { cf_payment_id: { not: null }, updated_at: { lte: staleWithPid } }
      ]
    },
    select: { id: true, order_id: true },
    take: 50,
    orderBy: { updated_at: "asc" }
  });

  for (const r of rows) {
    try {
      const st = await cashfreeGetPgOrderStatus(r.order_id);
      const orderStatus = String(st.order_status ?? "").toUpperCase();
      const paymentStatus = String(st.payment_status ?? "").toUpperCase();
      const success =
        orderStatus === "PAID" ||
        paymentStatus === "SUCCESS" ||
        orderStatus === "SUCCESS";
      const failed =
        paymentStatus === "FAILED" ||
        paymentStatus === "USER_DROPPED" ||
        orderStatus === "FAILED" ||
        orderStatus === "CANCELLED" ||
        orderStatus === "EXPIRED";

      if (success) {
        await prisma.cashfreeOrder.updateMany({
          where: { id: r.id, status: "processing" },
          data: { status: "paid" }
        });
      } else if (failed) {
        await prisma.cashfreeOrder.updateMany({
          where: { id: r.id, status: "processing" },
          data: { status: "rejected" }
        });
      } else {
        await prisma.cashfreeOrder.updateMany({
          where: { id: r.id, status: "processing" },
          data: { status: "pending" }
        });
      }
    } catch {
      // If provider lookup fails, keep row unchanged to avoid blind churn.
      continue;
    }
  }
}

export function startCashfreeRecoveryScheduler(): void {
  const run = async () => {
    try {
      await recoverStaleCashfreeProcessingOrders();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Cashfree processing recovery failed", err);
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, RECOVERY_INTERVAL_MS);
}
