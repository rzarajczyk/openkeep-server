# OpenKeep web

React and TypeScript single-page client for OpenKeep.

## Development

```sh
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:8080` and strips the `/api` prefix.

## Checks

```sh
npm run typecheck
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

## Container

The multi-stage Docker image builds the SPA and serves it with unprivileged nginx
on port `8080`. Requests under `/api/` are proxied to `http://api:8080/`.
