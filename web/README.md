# OpenKeep web

React and TypeScript single-page client for OpenKeep.

## Development

```sh
npm ci
npm run dev
```

Vite proxies `/api` to `http://localhost:8080` and strips the `/api` prefix.

## Editor notes

- TEXT and LIST notes default to a read-only **Markdown preview**; the **M** toolbar
  control switches to plain editing.
- In plain mode, **Formatting** (**A**) inserts markdown markers. TEXT gets the full
  menu; LIST is limited to bold / italic / strikethrough / inline code.
- Preview HTML comes from `POST /api/markdown/preview` (`inline: true` for list items).
- Toolbar tooltips use the shared `Tooltip` component (portaled into the note dialog).

Product behavior is specified in [`../openkeep-spec.md`](../openkeep-spec.md).

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
