-- CreateTable
CREATE TABLE "EventPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EventPlan_eventId_key" ON "EventPlan"("eventId");

-- CreateIndex
CREATE INDEX "EventPlan_updatedAt_idx" ON "EventPlan"("updatedAt");
