/**
 * One-time migration: normalize every member id to EX + 6 digits (or keep EX + 8 legacy) across the database.
 *
 * Rules for mapping a legacy string:
 * - Already EX###### or EX######## → unchanged
 * - Exactly 10 digits → EX + last 6 digits
 * - Exactly 8 / 6 digits → EX + last 6 / those 6
 * - Anything else → deterministic unique EX###### (6 digits, each digit unique in the numeric part)
 *
 * Tables updated: users (regNo, sponser_id), deposits, support_tickets, coins, wallet, bank,
 * packages, perday, loan, insurance, cibile_report_request, cashfree_orders.
 *
 * Usage (from backend/, with DATABASE_URL set):
 *   npx tsx prisma/scripts/migrate-regno-to-ex.ts
 *   npx tsx prisma/scripts/migrate-regno-to-ex.ts --dry-run
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  generateRandomExSixUniqueDigitRegNo,
  isStoredMemberRegNo,
  proposeMemberIdFromLegacy
} from "../../src/shared/regNo.js";

const dryRun = process.argv.includes("--dry-run");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function randomExNotIn(taken: Set<string>): string {
  for (let i = 0; i < 100_000; i++) {
    const c = generateRandomExSixUniqueDigitRegNo();
    if (!taken.has(c)) return c;
  }
  throw new Error("Could not allocate a unique EX###### id");
}

/** Deterministic EX###### (6 unique digits) from arbitrary string (reproducible migration). */
function stableExFromArbitrary(s: string, taken: Set<string>): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  for (let attempt = 0; attempt < 100_000; attempt++) {
    const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let x = (h + attempt) >>> 0;
    const picked: number[] = [];
    for (let k = 0; k < 6; k++) {
      x = Math.imul(x, 1664525) + 1013904223;
      const idx = x % pool.length;
      picked.push(pool[idx]!);
      pool.splice(idx, 1);
    }
    const c = `EX${picked.join("")}`;
    if (!taken.has(c)) return c;
  }
  return randomExNotIn(taken);
}

async function collectDistinctRegStrings(): Promise<Set<string>> {
  const out = new Set<string>();
  type Row = { v: string | null };

  const q = async (sql: string) => {
    const rows = await prisma.$queryRawUnsafe<Row[]>(sql);
    for (const r of rows) {
      if (r.v && r.v !== "0") out.add(r.v);
    }
  };

  await q(`SELECT DISTINCT "regNo" AS v FROM "users" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(
    `SELECT DISTINCT "sponser_id" AS v FROM "users" WHERE "sponser_id" IS NOT NULL AND "sponser_id" != '' AND "sponser_id" != '0'`
  );
  await q(`SELECT DISTINCT "regNo" AS v FROM "deposits" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(`SELECT DISTINCT "regNo" AS v FROM "support_tickets" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(`SELECT DISTINCT "regNo" AS v FROM "coins" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(`SELECT DISTINCT "regNo" AS v FROM "wallet" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(`SELECT DISTINCT "regNo" AS v FROM "bank" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(`SELECT DISTINCT "regNo" AS v FROM "packages" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(`SELECT DISTINCT "regNo" AS v FROM "perday" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(`SELECT DISTINCT "regNo" AS v FROM "loan" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(`SELECT DISTINCT "regNo" AS v FROM "insurance" WHERE "regNo" IS NOT NULL AND "regNo" != ''`);
  await q(
    `SELECT DISTINCT "regNo" AS v FROM "cibile_report_request" WHERE "regNo" IS NOT NULL AND "regNo" != ''`
  );
  await q(`SELECT DISTINCT "reg_no" AS v FROM "cashfree_orders" WHERE "reg_no" IS NOT NULL AND "reg_no" != ''`);

  return out;
}

function buildReplacementMap(strings: Iterable<string>): Map<string, string> {
  const taken = new Set<string>();
  const map = new Map<string, string>();

  for (const s of strings) {
    if (isStoredMemberRegNo(s)) {
      taken.add(s);
      map.set(s, s);
    }
  }

  for (const s of strings) {
    if (map.has(s)) continue;
    const proposed = proposeMemberIdFromLegacy(s);
    let next: string;
    if (proposed && !taken.has(proposed)) {
      next = proposed;
    } else {
      next = stableExFromArbitrary(s, taken);
    }
    taken.add(next);
    map.set(s, next);
  }

  return map;
}

async function applyMap(map: Map<string, string>) {
  const pairs = [...map.entries()].filter(([a, b]) => a !== b);
  if (pairs.length === 0) {
    console.log("No changes needed.");
    return;
  }

  // Default interactive transaction timeout is 5s; remote DBs often need more.
  const txOptions = { maxWait: 60_000, timeout: 300_000 };

  await prisma.$transaction(async (tx) => {
    for (const [oldV, newV] of pairs) {
      await Promise.all([
        tx.wallet.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.bank.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.deposit.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.coin.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.package.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.perday.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.loan.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.insurance.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.cibileReportRequest.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.supportTicket.updateMany({ where: { regNo: oldV }, data: { regNo: newV } }),
        tx.cashfreeOrder.updateMany({ where: { reg_no: oldV }, data: { reg_no: newV } })
      ]);
    }

    for (const [oldV, newV] of pairs) {
      await tx.user.updateMany({ where: { sponser_id: oldV }, data: { sponser_id: newV } });
    }

    for (const [oldV, newV] of pairs) {
      await tx.user.updateMany({ where: { regNo: oldV }, data: { regNo: newV } });
    }
  }, txOptions);

  console.log(`Applied ${pairs.length} id replacement(s).`);
}

async function verify(): Promise<boolean> {
  const users = await prisma.user.findMany({
    select: { id: true, regNo: true, sponser_id: true }
  });
  let ok = true;
  for (const u of users) {
    if (u.regNo && !isStoredMemberRegNo(u.regNo)) {
      console.error(`Invalid users.regNo id=${u.id} regNo=${u.regNo}`);
      ok = false;
    }
    if (
      u.sponser_id &&
      u.sponser_id !== "0" &&
      u.sponser_id !== "" &&
      !isStoredMemberRegNo(u.sponser_id)
    ) {
      console.error(`Invalid users.sponser_id id=${u.id} sponser_id=${u.sponser_id}`);
      ok = false;
    }
  }

  const checkTable = async (label: string, rows: { regNo: string | null }[]) => {
    for (const r of rows) {
      if (r.regNo && !isStoredMemberRegNo(r.regNo)) {
        console.error(`Invalid ${label} regNo=${r.regNo}`);
        ok = false;
      }
    }
  };

  await checkTable(
    "deposits",
    await prisma.deposit.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "support_tickets",
    await prisma.supportTicket.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "coins",
    await prisma.coin.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "wallet",
    await prisma.wallet.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "bank",
    await prisma.bank.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "packages",
    await prisma.package.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "perday",
    await prisma.perday.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "loan",
    await prisma.loan.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "insurance",
    await prisma.insurance.findMany({ select: { regNo: true }, where: { regNo: { not: null } } })
  );
  await checkTable(
    "cibile_report_request",
    await prisma.cibileReportRequest.findMany({
      select: { regNo: true },
      where: { regNo: { not: null } }
    })
  );

  const cf = await prisma.cashfreeOrder.findMany({ select: { reg_no: true } });
  for (const r of cf) {
    if (!isStoredMemberRegNo(r.reg_no)) {
      console.error(`Invalid cashfree_orders.reg_no=${r.reg_no}`);
      ok = false;
    }
  }

  return ok;
}

async function main() {
  console.log(dryRun ? "DRY RUN — no writes" : "LIVE migration");
  const strings = await collectDistinctRegStrings();
  console.log(`Distinct reg strings found: ${strings.size}`);

  const map = buildReplacementMap(strings);
  const changes = [...map.entries()].filter(([a, b]) => a !== b);
  console.log(`Replacements planned: ${changes.length}`);
  for (const [from, to] of changes.slice(0, 50)) {
    console.log(`  ${from} -> ${to}`);
  }
  if (changes.length > 50) console.log(`  ... and ${changes.length - 50} more`);

  if (dryRun) {
    console.log("Dry run complete.");
    return;
  }

  await applyMap(map);
  const ok = await verify();
  if (!ok) {
    console.error("Verification reported invalid reg ids — review DB manually.");
    process.exitCode = 1;
    return;
  }
  console.log("Verification passed: all scanned ids match EX###### or legacy EX########.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
