/*
  Warnings:

  - You are about to drop the column `description` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `website` on the `organizations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "description",
DROP COLUMN "website";
