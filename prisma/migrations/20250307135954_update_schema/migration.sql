/*
  Warnings:

  - You are about to drop the column `userId` on the `GameSession` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_userId_fkey";

-- AlterTable
ALTER TABLE "GameSession" DROP COLUMN "userId";
