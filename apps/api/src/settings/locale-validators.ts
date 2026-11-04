import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isIanaTimezone } from '@aivoryx/shared';

/**
 * Validates a timezone against the runtime's own `Intl` resolver rather than
 * a fixed list — `Intl.supportedValuesOf('timeZone')` only enumerates
 * canonical zone names and would reject legitimate, still-valid aliases such
 * as "Asia/Kolkata" (canonical: "Asia/Calcutta") that `Intl.DateTimeFormat`
 * itself accepts and that every date this app later formats also accepts.
 */
export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isIanaTimezone(value);
        },
        defaultMessage(): string {
          return 'timezone must be a valid IANA timezone name';
        },
      },
    });
  };
}
