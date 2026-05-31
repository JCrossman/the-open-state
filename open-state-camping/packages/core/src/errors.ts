/**
 * Error types that cross the provider boundary.
 *
 * `UpstreamError`/`QueueItError` mean the booking platform failed or gated us;
 * `InvalidInputError` means a citizen-supplied value cannot be used as given
 * (its message names the valid options, never guessing — Constitution Art. 7.1).
 */

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class QueueItError extends UpstreamError {
  constructor(message: string) {
    super(message);
    this.name = "QueueItError";
  }
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}
