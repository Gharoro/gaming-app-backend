/*
  Warnings:

  - A unique constraint covering the columns `[sessionToken]` on the table `GameSession` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sessionToken` to the `GameSession` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "sessionToken" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_sessionToken_key" ON "GameSession"("sessionToken");

