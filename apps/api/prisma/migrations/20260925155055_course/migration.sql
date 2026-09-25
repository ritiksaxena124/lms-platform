-- CreateTable
CREATE TABLE "course" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "teacher_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "level_value_id" UUID NOT NULL,
    "status_value_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "course_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_course_teacher_created" ON "course"("teacher_user_id", "is_active", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uk_course_teacher_slug" ON "course"("teacher_user_id", "slug");

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_level_value_id_fkey" FOREIGN KEY ("level_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_status_value_id_fkey" FOREIGN KEY ("status_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
