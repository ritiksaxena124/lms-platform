import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isValidIanaTimeZone } from '@lms/shared';

/**
 * `@IsString()` would accept `UTC+5`, `Delhi` and `Mars/Olympus_Mons`, and every one of
 * them survives the database only to fail when a student's slot is rendered. Checking it
 * against `Intl` here means the wrong value is a 400 on the form that typed it, not a
 * broken screen somewhere else.
 */
export function IsIanaTimeZone(options?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && value.length > 0 && isValidIanaTimeZone(value),
        defaultMessage: () => `${String(propertyName)} must be an IANA zone like Asia/Kolkata`,
      },
    });
  };
}
