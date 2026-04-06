-- Ensure digital declaration audit table exists for compliance logs.
CREATE TABLE IF NOT EXISTS "digital_declaration_audits" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "regNo" TEXT,
  "agreed" BOOLEAN NOT NULL DEFAULT TRUE,
  "ipAddress" TEXT,
  "context" TEXT,
  "declarationVersion" TEXT DEFAULT 'v1',
  "fullTextSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "digital_declaration_audits"
  ADD COLUMN IF NOT EXISTS "agreed" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "declarationVersion" TEXT DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS "fullTextSnapshot" TEXT;

CREATE INDEX IF NOT EXISTS "digital_declaration_audits_userId_idx"
  ON "digital_declaration_audits"("userId");
CREATE INDEX IF NOT EXISTS "digital_declaration_audits_createdAt_idx"
  ON "digital_declaration_audits"("createdAt");
