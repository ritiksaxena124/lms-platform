-- CreateTable
CREATE TABLE "action_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action_code" TEXT NOT NULL,
    "section_code" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_user_id" UUID,
    "actor_role_code" TEXT,
    "target_table" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_action_log_actor" ON "action_log"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_action_log_target" ON "action_log"("target_table", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_action_log_action" ON "action_log"("action_code", "created_at");

-- CreateIndex
CREATE INDEX "ix_action_log_recent" ON "action_log"("created_at");

-- AddForeignKey
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
