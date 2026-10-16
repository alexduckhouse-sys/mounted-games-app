// Stand-in for vite-plugin-pwa's virtual module so imports resolve under Vitest; tests replace it with vi.mock.
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}
