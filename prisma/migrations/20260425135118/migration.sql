/*
  Warnings:

  - A unique constraint covering the columns `[slug,applicationId]` on the table `organizations` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "organizations_slug_key";

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "applicationId" TEXT;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "applicationId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_applicationId_key" ON "organizations"("slug", "applicationId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
