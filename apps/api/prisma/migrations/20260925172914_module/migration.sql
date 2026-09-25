-- CreateTable
CREATE TABLE "module" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "module_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_module_course_order" ON "module"("course_id", "is_active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "uk_module_course_position" ON "module"("course_id", "position");

-- AddForeignKey
ALTER TABLE "module" ADD CONSTRAINT "module_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
