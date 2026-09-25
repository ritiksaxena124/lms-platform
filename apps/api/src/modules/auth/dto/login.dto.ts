import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * What the login form sends. The password is checked for shape only — never for strength.
 *
 * A `@Length(12, ...)` here would answer "too short" before the credential is tried, which
 * tells an attacker both that the address exists and how the rules are written. Strength
 * belongs at registration; here it can only say no.
 */
export class LoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
