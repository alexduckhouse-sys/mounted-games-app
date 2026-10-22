/** The message the API sent back, or a plain fallback when there wasn't one. */
export function deletionErrorMessage(error: unknown): string {
  const message = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  return typeof message === 'string' && message.trim()
    ? message
    : "We couldn't delete your account. Check your connection and try again.";
}
