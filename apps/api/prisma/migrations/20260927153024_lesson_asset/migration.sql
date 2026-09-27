-- CreateTable
CREATE TABLE "lesson_asset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lesson_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "stored_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lesson_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_lesson_asset_lesson_active" ON "lesson_asset"("lesson_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uk_lesson_asset_stored_key" ON "lesson_asset"("stored_key");

-- AddForeignKey
ALTER TABLE "lesson_asset" ADD CONSTRAINT "lesson_asset_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
