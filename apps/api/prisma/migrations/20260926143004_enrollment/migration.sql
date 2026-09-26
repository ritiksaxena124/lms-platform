-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_enrollment_student_list" ON "enrollment"("student_user_id", "is_active", "created_at");

-- CreateIndex
CREATE INDEX "ix_enrollment_course_roster" ON "enrollment"("course_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uk_enrollment_student_course" ON "enrollment"("course_id", "student_user_id");

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
