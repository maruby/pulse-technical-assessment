ALTER TABLE "Presence"
  ADD COLUMN "pendingFrom" TEXT,
  ADD COLUMN "pendingAt" TIMESTAMP(3),
  ADD COLUMN "connectedTo" TEXT;
