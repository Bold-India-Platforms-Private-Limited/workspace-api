-- Create table (safe to run even if it already exists)
CREATE TABLE IF NOT EXISTS "ProjectDocument" (
    "id"          TEXT         NOT NULL,
    "projectId"   TEXT         NOT NULL,
    "title"       TEXT         NOT NULL,
    "driveLink"   TEXT         NOT NULL,
    "description" TEXT,
    "tags"        TEXT[]       NOT NULL DEFAULT '{}',
    "addedById"   TEXT         NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectDocument_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectDocument_addedById_fkey"
        FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- If the table already existed without tags, add the column
ALTER TABLE "ProjectDocument" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';
