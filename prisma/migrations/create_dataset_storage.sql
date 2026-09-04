-- Dataset Storage: admin-managed folders of files stored in Cloudflare R2.
-- Idempotent — safe to run more than once.

-- Dataset folders are a global pool shared across every workspace; admins pick
-- which folders to attach to a project. workspaceId is kept (nullable) only so
-- older rows and any future scoping still have a home.
CREATE TABLE IF NOT EXISTS "DatasetFolder" (
    "id"          TEXT         NOT NULL,
    "workspaceId" TEXT,
    "name"        TEXT         NOT NULL,
    "description" TEXT,
    "createdById" TEXT         NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetFolder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DatasetFolder_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DatasetFolder_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Older deployments may already have the NOT NULL / CASCADE variant — relax it.
ALTER TABLE "DatasetFolder" ALTER COLUMN "workspaceId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "DatasetFolder_createdAt_idx"
    ON "DatasetFolder" ("createdAt" DESC);

CREATE TABLE IF NOT EXISTS "DatasetFile" (
    "id"           TEXT         NOT NULL,
    "folderId"     TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "key"          TEXT         NOT NULL,
    "url"          TEXT         NOT NULL,
    "size"         INTEGER      NOT NULL DEFAULT 0,
    "contentType"  TEXT         NOT NULL DEFAULT 'application/octet-stream',
    "uploadedById" TEXT         NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetFile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DatasetFile_folderId_fkey"
        FOREIGN KEY ("folderId") REFERENCES "DatasetFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DatasetFile_uploadedById_fkey"
        FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DatasetFile_folderId_createdAt_idx"
    ON "DatasetFile" ("folderId", "createdAt" DESC);

-- ProjectDocument: allow linking a dataset folder instead of a Drive link.
ALTER TABLE "ProjectDocument" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'link';
ALTER TABLE "ProjectDocument" ADD COLUMN IF NOT EXISTS "datasetFolderId" TEXT;
ALTER TABLE "ProjectDocument" ALTER COLUMN "driveLink" SET DEFAULT '';
ALTER TABLE "ProjectDocument" ALTER COLUMN "driveLink" DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ProjectDocument_datasetFolderId_fkey'
    ) THEN
        ALTER TABLE "ProjectDocument"
            ADD CONSTRAINT "ProjectDocument_datasetFolderId_fkey"
            FOREIGN KEY ("datasetFolderId") REFERENCES "DatasetFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
