CREATE TABLE IF NOT EXISTS "NdaSignature" (
    "id"          TEXT         NOT NULL,
    "userId"      TEXT         NOT NULL,
    "workspaceId" TEXT         NOT NULL,
    "signedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress"   TEXT,
    "userAgent"   TEXT,

    CONSTRAINT "NdaSignature_pkey"             PRIMARY KEY ("id"),
    CONSTRAINT "NdaSignature_userId_workspaceId_key" UNIQUE ("userId", "workspaceId"),
    CONSTRAINT "NdaSignature_userId_fkey"      FOREIGN KEY ("userId")      REFERENCES "User"("id")      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NdaSignature_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
