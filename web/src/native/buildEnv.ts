/**
 * Checks for the app build (`vite build --mode ios`). Inside the app the page's origin is
 * `capacitor://localhost`, so the relative defaults in api.ts (`/api`) and useLiveHub.ts (`/hubs/live`)
 * would point back into the bundle. Both must be absolute https addresses. The API should be the
 * website's `/api` path, so web/middleware.ts still adds the visitor's IP; the app never holds the proxy key.
 *
 * Dependency-free: vite.config.ts imports it under Node.
 */
export const NATIVE_BUILD_MODE = 'ios';

const REQUIRED = ['VITE_API_BASE', 'VITE_LIVE_HUB_URL'] as const;

/** Returns one message per problem; an empty list means the build can go ahead. */
export function nativeBuildEnvProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const name of REQUIRED) {
    const value = env[name]?.trim();
    if (!value) {
      problems.push(`${name} is not set. The app needs an absolute https address.`);
      continue;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      problems.push(`${name} must be an absolute https address, not "${value}".`);
      continue;
    }
    if (url.protocol !== 'https:') problems.push(`${name} must use https, not ${url.protocol.replace(':', '')}.`);
  }
  return problems;
}

/** Throws with every problem listed, so a misconfigured app build fails before anything is bundled. */
export function assertNativeBuildEnv(env: Record<string, string | undefined>): void {
  const problems = nativeBuildEnvProblems(env);
  if (problems.length) throw new Error(`The iPhone app build needs its server addresses:\n- ${problems.join('\n- ')}`);
}
