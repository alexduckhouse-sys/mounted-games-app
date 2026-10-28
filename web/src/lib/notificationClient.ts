/** Pages that mustn't be navigated away from by a tapped notification: leaving them stops a live camera or a scorer's session. */
const KEEP_PATHS = /\/(broadcast|score)(\/|$)/;

/**
 * Which open window a tapped notification should reuse: the first one that isn't on a broadcast or scoring page.
 * Returns undefined when there isn't one, and the caller opens a new window instead.
 */
export function pickNotificationClient<T extends { url: string }>(clients: readonly T[]): T | undefined {
  return clients.find((client) => {
    try { return !KEEP_PATHS.test(new URL(client.url).pathname); } catch { return true; }
  });
}
