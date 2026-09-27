-- CreateTable
CREATE TABLE "availability_rule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "teacher_user_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "slot_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "availability_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_availability_rule_teacher_week" ON "availability_rule"("teacher_user_id", "is_active", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "uk_availability_rule_start" ON "availability_rule"("teacher_user_id", "weekday", "start_minutes");

-- AddForeignKey
ALTER TABLE "availability_rule" ADD CONSTRAINT "availability_rule_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
