export type ClaudeErrorKind =
  | "auth" // 401
  | "forbidden" // 403
  | "bad_request" // 400
  | "too_large" // 413
  | "retryable" // network, 429, 5xx, 529 (after retries exhausted)
  | "timeout"
  | "aborted"
  | "cap_stopped" // user chose Stop at the monthly cap
  | "invalid_output"; // structured output failed validation after corrections

export class ClaudeError extends Error {
  constructor(
    readonly kind: ClaudeErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 529]);

export function classify(status: number | undefined, message: string, retryAfterMs?: number): ClaudeError {
  if (status === undefined) return new ClaudeError("retryable", message, undefined, retryAfterMs); // network
  if (status === 401) return new ClaudeError("auth", message, status);
  if (status === 403) return new ClaudeError("forbidden", message, status);
  if (status === 413) return new ClaudeError("too_large", message, status);
  if (status === 400) return new ClaudeError("bad_request", message, status);
  if (RETRY_STATUS.has(status)) return new ClaudeError("retryable", message, status, retryAfterMs);
  return new ClaudeError("bad_request", message, status);
}
