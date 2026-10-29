import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { nodeTests } from './src/test/nodeTests.ts';

// Vitest covers the logic layer in src/**/*.test.{ts,tsx}. The older node:test suite in tests/*.mjs
// keeps running separately (`npm test` runs both), so it is never picked up here.
export default defineConfig({
  resolve: {
    // vite-plugin-pwa provides this module at build time only; tests mock it (see src/pwa.test.ts).
    alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/test/pwa-register-stub.ts', import.meta.url)) },
  },
  test: {
    // Some UI tests take 6-8 s when the machine is busy (e.g. a dotnet test alongside); the 5 s
    // default turned that into false failures.
    testTimeout: 15_000,
    // Both projects inherit aliases, timeouts and mock/global resets. New tests default to the browser.
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: nodeTests, setupFiles: [] },
      },
      {
        extends: true,
        test: {
          name: 'browser', environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'],
          exclude: nodeTests, setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
    restoreMocks: true,
    mockReset: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Measured: src/lib, src/api.ts, src/auth, src/theme, src/competition, src/live, src/hooks,
      // src/lite, src/offline, src/weather, src/native, src/pwa.ts and the testable shared components.
      include: [
        'src/api.ts',
        'src/pwa.ts',
        'src/lib/**',
        'src/auth/**',
        'src/theme/**/*.{ts,tsx}',
        'src/competition/**',
        'src/live/**',
        'src/hooks/**',
        'src/lite/**',
        'src/offline/**',
        'src/weather/**',
        'src/native/**',
        'src/components/**',
      ],
      // Not measured, and why:
      //  - tests and test helpers, type declarations, src/types.ts (interfaces plus one constant table);
      //  - src/main.tsx (bootstrap) and src/sw.ts (service worker global scope; needs a real worker);
      //  - src/pages/** (route screens: large, mostly layout, better suited to browser tests);
      //  - AppShell, DiagramEditor and RaceDiagram (SVG/pointer-driven or whole-app composition, so a
      //    97% line target would need brittle snapshot-style tests).
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/**/*.d.ts',
        'src/types.ts',
        'src/main.tsx',
        'src/sw.ts',
        'src/pages/**',
        'src/components/AppShell.tsx',
        'src/components/DiagramEditor.tsx',
        'src/components/RaceDiagram.tsx',
      ],
      thresholds: { lines: 97, statements: 97, branches: 97, functions: 97 },
    },
  },
});
