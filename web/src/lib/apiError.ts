/** The `message` the API sent with a failed request, or the fallback when there isn't one (offline, a timeout, a crash). */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/** The HTTP status of a failed request, if the server answered at all. */
export function apiErrorStatus(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** The text of an ASP.NET problem response (`detail`, else `message`), or the fallback when there isn't one. */
export function problemMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { detail?: unknown } } } | null)?.response?.data;
  return typeof data?.detail === 'string' && data.detail.trim() ? data.detail : apiErrorMessage(err, fallback);
}
