-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN "dueDate" DATETIME;

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "agreedCost" INTEGER NOT NULL DEFAULT 0,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "paymentDueDate" DATETIME,
    "notes" TEXT,
    "eventId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vendor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Vendor_eventId_idx" ON "Vendor"("eventId");

-- CreateIndex
CREATE INDEX "Vendor_paymentDueDate_idx" ON "Vendor"("paymentDueDate");
