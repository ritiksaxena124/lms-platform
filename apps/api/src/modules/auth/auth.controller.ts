import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';

import { ENV } from '../../config/env.module';
import type { AppEnv } from '../../config/env';
import type { AuthenticatedUser } from './auth.guard';
import { AuthService, type PublicUser, type Session } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './session-cookie';
import { Public } from './public.decorator';

/** Credential endpoints get a tighter budget than the rest of the API. */
const CREDENTIAL_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

/** What a portal keeps after a sign-in: who you are, and how to prove it briefly. */
interface SessionResponse {
  user: PublicUser;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  @Public()
  @Post('register')
  @Throttle(CREDENTIAL_THROTTLE)
  async register(@Body() dto: RegisterDto): Promise<{ user: PublicUser }> {
    const user = await this.auth.register(dto);
    return { user };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  async login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const session = await this.auth.login(dto, userAgent);
    setRefreshCookie(res, session.refreshToken, this.env);
    return toSessionResponse(session);
  }

  /**
   * Called on portal load whenever a session might still be alive. The access token is not
   * kept by the browser at all, so this is the only way a page reload stays signed in.
   *
   * It authenticates from the cookie rather than a bearer token, because by the time a
   * portal boots there is no access token left to present.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Headers('cookie') cookie: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const session = await this.auth.refresh(readRefreshCookie(cookie), userAgent);
    setRefreshCookie(res, session.refreshToken, this.env);
    return toSessionResponse(session);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<{ user: PublicUser }> {
    return this.auth.me(user.id).then((account) => ({ user: account }));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(cookie));
    clearRefreshCookie(res, this.env);
  }
}

function toSessionResponse(session: Session): SessionResponse {
  return {
    user: session.user,
    accessToken: session.accessToken,
    tokenType: 'Bearer',
    expiresIn: session.expiresInSeconds,
  };
}
