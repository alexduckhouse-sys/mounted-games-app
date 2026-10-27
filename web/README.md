# MG App — Web PWA (`web/`)

React 19 + TypeScript + Vite 8 Progressive Web App for the Mounted Games Competition Manager.

See [`web/CLAUDE.md`](./CLAUDE.md) for the complete frontend guide, route map, offline caching rules, SignalR hub handlers, and testing patterns, and [`../docs/designs/design-decisions.md`](../docs/designs/design-decisions.md) for the UI/UX house style.

## Commands (`web/`)

```bash
npm run dev            # Start Vite dev server on http://localhost:5173 (proxies /api and /hubs to :5050)
npm run lint           # ESLint (0 warnings/errors required in CI)
npm test               # Run Node test suite (tests/*.test.mjs) + Vitest unit/component suite
npm run test:coverage  # Enforce >= 97% coverage across lines, statements, branches and functions
npm run build          # TypeScript project build (tsc -b) + Vite production bundle + Workbox SW
```
