export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, "bad_request", msg, details);
export const unauthorized = (msg = "Sign in required") => new ApiError(401, "unauthorized", msg);
export const forbidden = (msg = "You do not have access to this resource") => new ApiError(403, "forbidden", msg);
export const notFound = (msg = "Not found") => new ApiError(404, "not_found", msg);
export const conflict = (msg: string) => new ApiError(409, "conflict", msg);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new ApiError(429, "rate_limited", `Too many requests. Try again in ${retryAfterSeconds}s.`, { retryAfterSeconds });
