import { Body, Controller, Post } from '@nestjs/common';

import type { PublicUser } from './auth.service';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<{ user: PublicUser }> {
    const user = await this.auth.register(dto);
    return { user };
  }
}
