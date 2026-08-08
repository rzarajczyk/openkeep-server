# OwnKeep web

React and TypeScript single-page client for OwnKeep.

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

Production uses the **unified** root [Dockerfile](../Dockerfile): the SPA is built
and copied into the Spring Boot JAR (`classpath:/static`). Spring strips the
`/api` prefix (same as this Vite proxy) and serves the UI and API on port `8080`.

The standalone [Dockerfile](Dockerfile) (nginx + `/api` proxy to hostname `api`)
remains for the existing OMV dual-image stack until that deploy is migrated.
