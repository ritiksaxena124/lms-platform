-- CreateTable
CREATE TABLE "class_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_class_series_course_week" ON "class_series"("course_id", "is_active", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "uk_class_series_course_slot" ON "class_series"("course_id", "weekday", "start_minutes");

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "teacher_user_id" UUID NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "reason" TEXT,
    "is_recurring_annually" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_holiday_teacher_active" ON "holiday"("teacher_user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uk_holiday_teacher_date" ON "holiday"("teacher_user_id", "date");

-- AddForeignKey
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
