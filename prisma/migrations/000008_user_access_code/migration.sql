ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "access_code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_access_code_key" ON "users"("access_code");
