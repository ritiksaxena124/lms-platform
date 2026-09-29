-- CreateIndex
CREATE INDEX "ix_mail_outbox_recipient" ON "mail_outbox"("recipient_user_id", "created_at");
