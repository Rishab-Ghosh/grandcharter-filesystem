export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class InvalidMoveError extends Error {
  readonly code = 'INVALID_MOVE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoveError';
  }
}

export class NotDownloadableError extends Error {
  readonly code = 'NOT_DOWNLOADABLE';
  constructor(message: string) {
    super(message);
    this.name = 'NotDownloadableError';
  }
}
