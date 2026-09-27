-- AlterTable
ALTER TABLE "booking" ADD COLUMN     "room_name" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "booking_room_name_key" ON "booking"("room_name");
