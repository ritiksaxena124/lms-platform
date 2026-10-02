-- CreateTable
CREATE TABLE "class_occurrence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "series_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurrence_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status_value_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "class_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_class_occurrence_teacher_calendar" ON "class_occurrence"("teacher_user_id", "is_active", "starts_at");

-- CreateIndex
CREATE INDEX "ix_class_occurrence_course_calendar" ON "class_occurrence"("course_id", "is_active", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "uk_class_occurrence_series_instant" ON "class_occurrence"("series_id", "starts_at");

-- CreateIndex
CREATE INDEX "ix_class_attendance_student" ON "class_attendance"("student_user_id", "is_active");

-- CreateIndex
CREATE INDEX "ix_class_attendance_status" ON "class_attendance"("status_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_class_attendance_person_class" ON "class_attendance"("occurrence_id", "student_user_id");

-- AddForeignKey
ALTER TABLE "class_occurrence" ADD CONSTRAINT "class_occurrence_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "class_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_occurrence" ADD CONSTRAINT "class_occurrence_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_occurrence" ADD CONSTRAINT "class_occurrence_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "class_occurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_status_value_id_fkey" FOREIGN KEY ("status_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
