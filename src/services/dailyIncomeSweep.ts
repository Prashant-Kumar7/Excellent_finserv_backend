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

function istWallClockParts(d: Date): { y: number; mo: number; d: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    f.formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, x.value])
  ) as Record<string, string>;
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day) };
}

/** IST civil date/time as instant (ms). IST is fixed UTC+05:30. */
function istToUtcMs(y: number, mo: number, d: number, hh: number, mm: number, ss: number): number {
  const pad = (n: number) => String(n).padStart(2, "0");
  return Date.parse(`${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}.000+05:30`);
}

function addOneIstCalendarDay(y: number, mo: number, d: number): { y: number; mo: number; d: number } {
  const noon = istToUtcMs(y, mo, d, 12, 0, 0);
  return istWallClockParts(new Date(noon + 24 * 60 * 60 * 1000));
}

function msUntilNextIst2359(now: Date): number {
  const { y, mo, d } = istWallClockParts(now);
  let targetMs = istToUtcMs(y, mo, d, 23, 59, 0);
  if (now.getTime() >= targetMs) {
    const n = addOneIstCalendarDay(y, mo, d);
    targetMs = istToUtcMs(n.y, n.mo, n.d, 23, 59, 0);
  }
  return Math.max(1_000, targetMs - now.getTime());
}

/** My Income (`wallet` ledger) → E-wallet (`bank`). */
async function sweepWalletToBankOnce(runDate: Date): Promise<void> {
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

/** Rewards (`coin` ledger) → E-wallet (`bank`). */
async function sweepCoinToBankOnce(runDate: Date): Promise<void> {
  const dateKey = istDateKey(runDate);
  const marker = `daily_rewards_sweep_${dateKey}`;

  const grouped = await prisma.coin.groupBy({
    by: ["regNo"],
    where: { regNo: { not: null } },
    _sum: { amount: true },
  });

  for (const row of grouped) {
    const regNo = row.regNo;
    if (!regNo) continue;
    const balance = Number(row._sum.amount ?? 0);
    if (!Number.isFinite(balance) || balance <= 0) continue;

    const alreadyDone = await prisma.coin.findFirst({
      where: { regNo, comment: marker },
      select: { id: true },
    });
    if (alreadyDone) continue;

    await prisma.$transaction(async (tx) => {
      await tx.coin.create({
        data: {
          regNo,
          amount: -balance,
          comment: marker,
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

async function sweepMyIncomeAndRewardsToEwalletOnce(runDate: Date): Promise<void> {
  await sweepWalletToBankOnce(runDate);
  await sweepCoinToBankOnce(runDate);
}

export function startDailyIncomeSweepScheduler(): void {
  const run = async () => {
    try {
      await sweepMyIncomeAndRewardsToEwalletOnce(new Date());
      // eslint-disable-next-line no-console
      console.log("Daily My Income + Rewards → E-wallet sweep completed");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Daily E-wallet sweep failed", err);
    }
  };

  const delay = msUntilNextIst2359(new Date());
  setTimeout(() => {
    void run();
    setInterval(() => {
      void run();
    }, 24 * 60 * 60 * 1000);
  }, delay);
}
