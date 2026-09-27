-- AlterTable
ALTER TABLE "course" ADD COLUMN     "demo_bookings_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_user_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "type_value_id" UUID NOT NULL,
    "status_value_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "slot_held_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_booking_student_calendar" ON "booking"("student_user_id", "is_active", "starts_at");

-- CreateIndex
CREATE INDEX "ix_booking_teacher_calendar" ON "booking"("teacher_user_id", "is_active", "starts_at");

-- CreateIndex
CREATE INDEX "ix_booking_course_schedule" ON "booking"("course_id", "is_active", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "uk_booking_slot_hold" ON "booking"("teacher_user_id", "slot_held_at");

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_type_value_id_fkey" FOREIGN KEY ("type_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_status_value_id_fkey" FOREIGN KEY ("status_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
