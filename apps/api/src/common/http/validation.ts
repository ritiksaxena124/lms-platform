import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { API_ERROR_CODES } from '@lms/shared';
import type { ValidationError } from 'class-validator';

/**
 * Flattens class-validator's tree into `{ field: [messages] }`.
 *
 * The API used to send a flat list of sentences, which meant a client that wanted to
 * highlight a field had to parse English to find out which one it was about. Keyed by
 * property, the same payload drives both the inline error and the toast.
 */
export function validationByField(errors: readonly ValidationError[]): Record<string, string[]> {
  const flattened: Record<string, string[]> = {};

  for (const error of errors) {
    const messages = Object.values(error.constraints ?? {});
    if (messages.length > 0) {
      flattened[error.property] = [...(flattened[error.property] ?? []), ...messages];
    }
    if (error.children?.length) {
      const nested = validationByField(error.children);
      for (const [property, nestedMessages] of Object.entries(nested)) {
        flattened[property] = [...(flattened[property] ?? []), ...nestedMessages];
      }
    }
  }

  return flattened;
}

/** Unknown properties are stripped *and* rejected, so a client cannot smuggle `isActive`
 * into a create payload; a nested object is reported against its own field name. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Check the highlighted fields.',
        details: { validation: validationByField(errors) },
      }),
  });
}
