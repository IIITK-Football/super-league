/** Thrown for a missing configuration value. Errors name variables but never include their values. */
export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}
