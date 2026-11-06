ALTER TABLE "Presence"
  ADD COLUMN "disconnectedAt" TIMESTAMP(3),
  ADD COLUMN "leaderTabId" TEXT;

CREATE TABLE "PresenceTab" (
  "id" TEXT NOT NULL,
  "presenceId" TEXT NOT NULL,
  "lastSeen" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "PresenceTab_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PresenceTab_presenceId_fkey" FOREIGN KEY ("presenceId") REFERENCES "Presence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ActivitySignal" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "message" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActivitySignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivitySignal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Presence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "ActivitySignal"
  ADD CONSTRAINT "ActivitySignal_category_check"
    CHECK ("category" IN ('Exploring', 'Casual Chat', 'Gaming', 'Music', 'Deep Conversations', 'Just Passing By', 'Looking for Recommendations', 'Custom')),
  ADD CONSTRAINT "ActivitySignal_message_length_check"
    CHECK ("message" IS NULL OR char_length("message") <= 120);

CREATE TABLE "WaveRequest" (
  "id" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "signalId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WaveRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaveRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Presence"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaveRequest_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Presence"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaveRequest_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "ActivitySignal"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Block" (
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Block_pkey" PRIMARY KEY ("blockerId", "blockedId"),
  CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "Presence"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "Presence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SignalReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "message" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignalReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimitBucket" (
  "presenceId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "bucketAt" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("presenceId", "action", "bucketAt"),
  CONSTRAINT "RateLimitBucket_presenceId_fkey" FOREIGN KEY ("presenceId") REFERENCES "Presence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ActivitySignal_ownerId_key" ON "ActivitySignal"("ownerId");
CREATE INDEX "Presence_disconnectedAt_idx" ON "Presence"("disconnectedAt");
CREATE INDEX "PresenceTab_presenceId_releasedAt_lastSeen_idx" ON "PresenceTab"("presenceId", "releasedAt", "lastSeen");
CREATE INDEX "ActivitySignal_isActive_updatedAt_idx" ON "ActivitySignal"("isActive", "updatedAt");
CREATE INDEX "WaveRequest_recipientId_status_createdAt_idx" ON "WaveRequest"("recipientId", "status", "createdAt");
CREATE INDEX "WaveRequest_senderId_status_createdAt_idx" ON "WaveRequest"("senderId", "status", "createdAt");
CREATE INDEX "WaveRequest_senderId_recipientId_status_createdAt_idx" ON "WaveRequest"("senderId", "recipientId", "status", "createdAt");
CREATE INDEX "Block_blockedId_blockerId_idx" ON "Block"("blockedId", "blockerId");
CREATE INDEX "SignalReport_createdAt_idx" ON "SignalReport"("createdAt");
CREATE INDEX "SignalReport_targetId_createdAt_idx" ON "SignalReport"("targetId", "createdAt");
CREATE INDEX "RateLimitBucket_bucketAt_idx" ON "RateLimitBucket"("bucketAt");
