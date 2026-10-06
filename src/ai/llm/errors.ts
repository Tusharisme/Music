/** What went wrong, for retry decisions and hints. */
export type AiErrorCode =
  'auth' | 'model' | 'limit' | 'size' | 'rejected' | 'format' | 'network' | 'provider' | 'refused' | 'setup';

/** A user-facing AI failure with an HTTP-style status (also used by the server routes). */
export class AiError extends Error {
  status: number;
  /** The provider's own message, kept for deciding how to retry. */
  detail: string;
  code: AiErrorCode;
  constructor(message: string, status = 500, detail = '', code: AiErrorCode = 'provider') {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

export function describeError(err: unknown): { message: string; status: number } {
  if (err instanceof AiError) return { message: err.message, status: err.status };
  if (err instanceof Error && err.name === 'AbortError') return { message: 'Cancelled.', status: 499 };
  if (err instanceof Error && err.name === 'TimeoutError')
    return { message: 'The AI took too long to answer – try again.', status: 504 };
  return { message: 'Unexpected AI error.', status: 500 };
}
