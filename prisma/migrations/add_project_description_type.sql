-- Run this on your production DB (safe – uses IF NOT EXISTS / IF NOT EXISTS)
ALTER TABLE "Project"
    ADD COLUMN IF NOT EXISTS "descriptionType" TEXT NOT NULL DEFAULT 'text';
