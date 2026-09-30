import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ReferenceModule } from '../../reference/reference.module';
import { CouponRepository } from './coupon.repository';
import { CouponService } from './coupon.service';
import { CouponController } from './coupon.controller';

@Module({
  imports: [PrismaModule, ReferenceModule],
  controllers: [CouponController],
  providers: [CouponRepository, CouponService],
  exports: [CouponService],
})
export class CouponModule {}
