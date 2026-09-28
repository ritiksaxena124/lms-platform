-- CreateTable
CREATE TABLE "email_template" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_code" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body_lines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta_label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_template_event_code_key" ON "email_template"("event_code");
