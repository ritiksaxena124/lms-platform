-- AlterTable
ALTER TABLE "course" ADD COLUMN     "price_currency_value_id" UUID,
ADD COLUMN     "price_minor_units" INTEGER;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_price_currency_value_id_fkey" FOREIGN KEY ("price_currency_value_id") REFERENCES "lkp_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
