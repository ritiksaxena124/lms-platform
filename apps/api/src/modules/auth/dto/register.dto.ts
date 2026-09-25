import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { SELF_REGISTERABLE_ROLES } from '@lms/shared';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The form a stranger submits. Everything that decides *who they become* is either absent
 * or drawn from a list the server owns — there is no `isActive`, no `role: 'ops'`, and no
 * password that reaches a log line.
 */
export class RegisterDto {
  /** Lower-cased here, not in the database, so every later lookup by address is exact. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  /** 12 characters is the floor that makes offline cracking expensive without pushing
   * people to write a password down. No maximum gymnastics: scrypt has no 72-byte cap. */
  @IsString()
  @Length(12, 200)
  password!: string;

  @Transform(trimmed)
  @IsString()
  @Length(1, 120)
  fullName!: string;

  @IsIn(SELF_REGISTERABLE_ROLES)
  role!: (typeof SELF_REGISTERABLE_ROLES)[number];

  /** Optional now; the teacher profile will make the working zone explicit. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 64)
  timezone?: string;
}
