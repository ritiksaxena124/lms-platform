import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ROLE_CODES } from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { CouponService } from './coupon.service';
import { CreateCouponDto, UpdateCouponDto, CouponResponse, CouponListResponse } from './dto/coupon.dto';

/**
 * CRUD endpoints for managing coupons on a teacher's courses.
 *
 * All routes are teacher-gated and scoped to courses the calling teacher owns.
 */
@Controller('courses/:courseId/coupons')
@Roles(ROLE_CODES.TEACHER)
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Get()
  async list(
    @Param('courseId') courseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CouponListResponse> {
    const items = await this.couponService.listByCourse(courseId, user.id);
    return { items };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('courseId') courseId: string,
    @Body() input: CreateCouponDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CouponResponse> {
    const coupon = await this.couponService.create(courseId, user.id, input);
    return { coupon };
  }

  @Get(':id')
  async getById(
    @Param('courseId') _courseId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CouponResponse> {
    const coupon = await this.couponService.findById(id, user.id);
    return { coupon };
  }

  @Patch(':id')
  async update(
    @Param('courseId') _courseId: string,
    @Param('id') id: string,
    @Body() input: UpdateCouponDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CouponResponse> {
    const coupon = await this.couponService.update(id, user.id, input);
    return { coupon };
  }

  @Post(':id/deactivate')
  async deactivate(
    @Param('courseId') _courseId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CouponResponse> {
    const coupon = await this.couponService.deactivate(id, user.id);
    return { coupon };
  }
}
