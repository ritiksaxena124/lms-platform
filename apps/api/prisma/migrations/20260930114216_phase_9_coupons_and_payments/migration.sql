-- CreateTable
CREATE TABLE "coupon" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type_value_id" UUID NOT NULL,
    "discount_amount" INTEGER NOT NULL,
    "valid_from" TIMESTAMPTZ(6),
    "valid_until" TIMESTAMPTZ(6),
    "max_redemptions" INTEGER,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enrollment_id" UUID NOT NULL,
    "coupon_id" UUID,
    "amount_minor_units" INTEGER NOT NULL,
    "currency_value_id" UUID NOT NULL,
    "status_value_id" UUID NOT NULL,
    "provider_reference" TEXT,
    "provider_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_coupon_course_active" ON "coupon"("course_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uk_coupon_course_code" ON "coupon"("course_id", "code");

-- CreateIndex
CREATE INDEX "ix_payment_enrollment" ON "payment"("enrollment_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_payment_status" ON "payment"("status_value_id", "created_at");

-- AddForeignKey
ALTER TABLE "coupon" ADD CONSTRAINT "coupon_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon" ADD CONSTRAINT "coupon_discount_type_value_id_fkey" FOREIGN KEY ("discount_type_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_currency_value_id_fkey" FOREIGN KEY ("currency_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_status_value_id_fkey" FOREIGN KEY ("status_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
