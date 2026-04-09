import { prisma } from "../shared/db.js";

const IST_TIME_ZONE = "Asia/Kolkata";

function istDateKey(d: Date): string {
  // YYYY-MM-DD in IST for idempotent comment tagging.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function msUntilNextIstMidnight(now: Date): number {
  // Convert current instant to IST wall-clock components.
  const nowIstText = now.toLocaleString("en-US", { timeZone: IST_TIME_ZONE });
  const nowIst = new Date(nowIstText);
  const nextMidnightIst = new Date(nowIst);
  nextMidnightIst.setHours(24, 0, 0, 0);
  return nextMidnightIst.getTime() - nowIst.getTime();
}

async function sweepIncomeToBankOnce(runDate: Date): Promise<void> {
  const dateKey = istDateKey(runDate);
  const marker = `daily_income_sweep_${dateKey}`;

  const grouped = await prisma.wallet.groupBy({
    by: ["regNo"],
    where: { regNo: { not: null } },
    _sum: { amount: true },
  });

  for (const row of grouped) {
    const regNo = row.regNo;
    if (!regNo) continue;
    const balance = Number(row._sum.amount ?? 0);
    if (!Number.isFinite(balance) || balance <= 0) continue;

    const alreadyDone = await prisma.wallet.findFirst({
      where: { regNo, comment: marker },
      select: { id: true },
    });
    if (alreadyDone) continue;

    await prisma.$transaction(async (tx) => {
      await tx.wallet.create({
        data: {
          regNo,
          amount: -balance,
          comment: marker,
          txn_type: "debit",
          status: "approved",
        },
      });
      await tx.bank.create({
        data: {
          regNo,
          amount: balance,
          comment: marker,
          txn_type: "credit",
          status: "approved",
        },
      });
    });
  }
}

export function startDailyIncomeSweepScheduler(): void {
  const run = async () => {
    try {
      await sweepIncomeToBankOnce(new Date());
      // eslint-disable-next-line no-console
      console.log("Daily income sweep completed");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Daily income sweep failed", err);
    }
  };

  const delay = Math.max(1_000, msUntilNextIstMidnight(new Date()));
  setTimeout(() => {
    void run();
    setInterval(() => {
      void run();
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

