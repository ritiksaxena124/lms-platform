-- CreateTable
CREATE TABLE "lesson" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "estimated_minutes" INTEGER,
    "position" INTEGER NOT NULL,
    "status_value_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_lesson_module_order" ON "lesson"("module_id", "is_active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "uk_lesson_module_position" ON "lesson"("module_id", "position");

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_status_value_id_fkey" FOREIGN KEY ("status_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
