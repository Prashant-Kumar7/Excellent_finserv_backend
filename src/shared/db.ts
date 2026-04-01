import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });

function toPgPlaceholders(sql: string) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pgSql = toPgPlaceholders(sql);
  const rows = await prisma.$queryRawUnsafe<T[]>(pgSql, ...(params as any[]));
  return rows;
}

export async function execute(sql: string, params: unknown[] = []) {
  const pgSql = toPgPlaceholders(sql);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`${pgSql} RETURNING id`, ...(params as any[]));
  return {
    rowCount: rows.length,
    insertId: rows[0]?.id as number | undefined
  };
}

