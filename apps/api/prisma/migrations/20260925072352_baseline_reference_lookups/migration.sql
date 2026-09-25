-- CreateTable
CREATE TABLE "lkp_type" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lkp_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lkp_value" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lkp_value_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uk_lkp_type_code" ON "lkp_type"("code");

-- CreateIndex
CREATE INDEX "ix_lkp_value_type_active" ON "lkp_value"("type_id", "is_active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "uk_lkp_value_type_code" ON "lkp_value"("type_id", "code");

-- AddForeignKey
ALTER TABLE "lkp_value" ADD CONSTRAINT "lkp_value_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "lkp_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
