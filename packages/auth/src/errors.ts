/**
 * Transport-neutral authentication failure. HTTP consumers map this to 401;
 * the WebSocket gateway maps it to an `unauthorized` problem and a disconnect.
 * This package deliberately does not depend on NestJS.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
