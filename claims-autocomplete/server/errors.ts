/** The query is not acceptable (for example, too long). Maps to HTTP 400. */
export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

/** The user may not work on this asset. Maps to HTTP 403. */
export class ForbiddenError extends Error {
  constructor(message = 'forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
