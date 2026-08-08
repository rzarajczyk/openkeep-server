---
name: ownkeep-local-dev
description: >-
  Run OwnKeep locally for development: API (Gradle bootRun) + Vite web dev server.
  Default database is remote Neon via .env; local Docker Postgres is optional.
  Use when the user asks to run, start, or develop the app locally.
---

# OwnKeep local development

**Default:** use the **Neon** `OWNKEEP_DATABASE_URL` from the repo-root `.env` unless the user asks for a local database.

**Production deploy:** hosted SaaS deploy lives in the private `ownkeep-saas` repo (`.cursor/skills/ownkeep-redeploy`).

## Stack (dev mode)

| Component | Command | URL |
|-----------|---------|-----|
| API | `cd api && ./gradlew bootRun` | `http://localhost:8080` |
| Web | `cd web && npm run dev` | `http://localhost:5173` (Vite default) |

Vite proxies `/api` → `http://localhost:8080` and strips the `/api` prefix (same behavior as the unified production image).

Open **`http://localhost:5173`** in the browser (not 8080 — the SPA is served by Vite in dev).

## Prerequisites

- Repo-root `.env` exists (`cp .env.example .env` if missing). Never commit `.env`.
- JDK 21 for the API
- Node 22 + `npm ci` in `web/` (first run or after lockfile changes)

Load env vars before `bootRun`. Neon URLs contain `&` — **quote** `OWNKEEP_DATABASE_URL` in `.env` (single quotes), or export vars without `source`:

```bash
eval "$(python3 <<'PY'
from pathlib import Path
for line in Path('.env').read_text().splitlines():
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    if k.startswith('OWNKEEP_'):
        print(f'export {k}={v!r}')
PY
)"
```

## Option A — Neon database (default)

Use when `.env` already contains a Neon connection string (`*.neon.tech`, `sslmode=require`, etc.). **Do not** start the local `db` Compose service.

```bash
# from repo root — load env (see Prerequisites), then:
cd api && ./gradlew bootRun
```

In a second terminal:

```bash
cd web && npm run dev
```

Verify:

```bash
curl -sf http://localhost:8080/health
```

## Option B — Local Docker Postgres

Use only when the user explicitly asks for a local database.

1. In `.env`, set a **Compose** URL (host `db`):

   ```bash
   OWNKEEP_DATABASE_URL=postgresql://ownkeep:<password>@db:5432/ownkeep
   ```

2. Start Postgres only:

   ```bash
   docker compose up -d db
   ```

3. For `bootRun` on the host, export the same credentials with host **`127.0.0.1`** (not `db`):

   ```bash
   export OWNKEEP_DATABASE_URL=postgresql://ownkeep:<password>@127.0.0.1:5432/ownkeep
   export OWNKEEP_ADMIN_USERNAME=...
   export OWNKEEP_ADMIN_PASSWORD=...
   cd api && ./gradlew bootRun
   ```

   The `db` container must publish port **5432** to the host for this to work.

4. Start the web dev server as in Option A.

## Bootstrap admin

Set `OWNKEEP_ADMIN_USERNAME` and `OWNKEEP_ADMIN_PASSWORD` in `.env`. They seed the first admin only when no admin exists yet.

## Full Docker quick start (not dev)

To run the unified production image locally (SPA + API in one container):

```bash
cp .env.example .env   # edit secrets; DB host must be "db" for Compose
docker compose up -d --build
open http://localhost:8080
```

## Stop

- API / web: `Ctrl+C` in their terminals
- Local DB only: `docker compose stop db`

## Do not

- Commit or print `.env` secrets
- Start `docker compose up -d db` when using Neon (default)
- Point the browser at `:8080` during Vite dev unless testing the API directly
