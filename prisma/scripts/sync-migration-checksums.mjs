/**
 * After editing migration.sql files that are already in _prisma_migrations,
 * Prisma reports "was modified after it was applied". This recomputes SHA-256
 * checksums from disk and updates the database (same approach as Prisma GH #12666).
 *
 * Usage (from backend/):  npm run prisma:sync-checksums
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const root = process.cwd();
const migrationsDir = join(root, 'prisma', 'migrations');

const prisma = new PrismaClient();
try {
  const dirs = readdirSync(migrationsDir).filter((d) => /^\d/.test(d));
  for (const name of dirs) {
    const sqlPath = join(migrationsDir, name, 'migration.sql');
    const buf = readFileSync(sqlPath);
    const checksum = createHash('sha256').update(buf).digest('hex');
    const updated = await prisma.$executeRaw`
      UPDATE "_prisma_migrations"
      SET "checksum" = ${checksum}
      WHERE "migration_name" = ${name}
    `;
    console.log(name, Number(updated), checksum.slice(0, 16) + '…');
  }
  console.log('Done. Re-run `npx prisma migrate dev` if needed.');
} finally {
  await prisma.$disconnect();
}
