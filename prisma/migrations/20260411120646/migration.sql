/*
  Warnings:

  - You are about to drop the column `organizationId` on the `roles` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `roles` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "roles" DROP CONSTRAINT "roles_organizationId_fkey";

-- DropIndex
DROP INDEX "roles_name_organizationId_key";

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "organizationId";

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
