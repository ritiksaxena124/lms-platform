import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  PERMISSION_CODES,
  type Booking,
  type BookingRequest,
  type BookingRoomResponse,
  type OpenSlotsResponse,
} from '@lms/shared';

import type { AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { OpenSlotsQueryDto } from './dto/open-slots-query.dto';

/**
 * A student's side of the calendar: the class times a course is offering them.
 *
 * The route is a read of an *offer*, not of a booking, and it is addressed by course rather than
 * by teacher. A teacher is free at a hundred instants across a term; what a student can act on is
 * the subset of those their relationship to one course opens, which is why the entitlement is
 * decided here rather than on a screen that would have to be told the rules to apply them.
 *
 * `@Permissions(BOOKING_REQUEST)` on this handler rather than the controller, because the teacher's
 * own routes — the requests waiting for an answer, and the answer — are the same table read from the
 * other side, and they belong to a different door.
 */
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('slots')
  @Permissions(PERMISSION_CODES.BOOKING_REQUEST)
  async slots(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OpenSlotsQueryDto,
  ): Promise<OpenSlotsResponse> {
    return this.bookings.openSlots(user.id, query.course);
  }

  /**
   * Take one of those minutes, which starts as a request rather than a place on a calendar.
   *
   * `200` on the first press as much as the second: the answer to "may I have this class" is the
   * same whether the row was written just now or by the click before it, and a portal that got
   * `201` once and `200` after would have to treat a double tap as two different outcomes. The
   * state the response carries is `pending`, because the teacher has not been asked yet — the
   * hold is what this write buys, not the class.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMISSION_CODES.BOOKING_REQUEST)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBookingDto,
  ): Promise<{ booking: Booking }> {
    return { booking: await this.bookings.create(user.id, dto) };
  }

  /**
   * The student's own classes, in one list.
   *
   * No course parameter, unlike the slots route: this is read from the person, not from the
   * thing they are looking at. A student with three teachers has one calendar to keep, and the
   * alternative — a screen calling this per course it happens to have open — is the same list
   * assembled twice in two places.
   */
  @Get()
  @Permissions(PERMISSION_CODES.BOOKING_REQUEST)
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<{ bookings: Booking[] }> {
    return { bookings: await this.bookings.listOwned(user.id) };
  }

  /** Let go of a class, and hand its minute back to the teacher's calendar. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMISSION_CODES.BOOKING_REQUEST)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ booking: Booking }> {
    return { booking: await this.bookings.cancel(user.id, id) };
  }

  /**
   * The teacher's door: what is waiting for them, what they are teaching, and what they say to it.
   *
   * Five routes on one table read from the other side, all under `@Permissions(BOOKING_ANSWER)` —
   * which is why the student routes above carry their own `@Permissions` rather than a
   * controller-wide one. The requests are pending only, because the answered ones are not a queue;
   * the class list keeps them all, because an answered Tuesday is still a Tuesday.
   */
  @Get('requests')
  @Permissions(PERMISSION_CODES.BOOKING_ANSWER)
  async requests(@CurrentUser() user: AuthenticatedUser): Promise<{ requests: BookingRequest[] }> {
    return { requests: await this.bookings.requestsFor(user.id) };
  }

  /**
   * The other teacher read of the same table: their own calendar, answered rows and all.
   *
   * `requests` is a queue and this is a schedule. A teacher asking "what have I not looked at yet"
   * and a teacher asking "what am I teaching on Tuesday" are different questions, and one route
   * carrying a `?pending=` flag would be the screen's tab structure written into the API.
   */
  @Get('classes')
  @Permissions(PERMISSION_CODES.BOOKING_ANSWER)
  async classes(@CurrentUser() user: AuthenticatedUser): Promise<{ bookings: BookingRequest[] }> {
    return { bookings: await this.bookings.classesFor(user.id) };
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMISSION_CODES.BOOKING_ANSWER)
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ booking: Booking }> {
    return { booking: await this.bookings.answer(user.id, id, 'confirm') };
  }

  /** No, which gives the minute back to the teacher's calendar the same write that wrote the no. */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMISSION_CODES.BOOKING_ANSWER)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ booking: Booking }> {
    return { booking: await this.bookings.answer(user.id, id, 'reject') };
  }

  /**
   * Say what became of a class that has gone by — it happened, or the student never came.
   *
   * The teacher's door, beside the confirm and the refuse, because they are the one who was in the
   * room. A student marking their own class taught would be a roll the absent people fill in.
   */
  @Post(':id/attendance')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMISSION_CODES.BOOKING_ANSWER)
  async attendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MarkAttendanceDto,
  ): Promise<{ booking: Booking }> {
    return { booking: await this.bookings.markAttendance(user.id, id, dto.status) };
  }

  /**
   * Ask for the room of a live class, and get the address if the answer is yes.
   *
   * The one route in this module with no `@Permissions`, because it is not a door belonging to one
   * side of the class: the student who booked it and the teacher who teaches it are both checked
   * against the row, and everybody else — a stranger, a classmate with a place in the same course,
   * another teacher — gets the silence a class that never existed gets.
   *
   * A `POST` for a read, on purpose. Its response is a secret with a URL's shape and the only lock
   * on the room, and a `GET` is an invitation to a browser's prefetch, a history entry and any
   * proxy that keeps responses. `no-store` is said on the way out for the same reason.
   */
  @Post(':id/room')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async room(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<BookingRoomResponse> {
    return { room: await this.bookings.roomFor(user.id, id) };
  }
}
