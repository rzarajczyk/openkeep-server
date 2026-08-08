# OwnKeep Core

Self-hosted, open-source notes app — text and checklist notes, labels, pinning, attachments, search, Google Keep import, and multi-user accounts. A small Google Keep-style alternative you run with Docker.

**License:** [Apache License 2.0](LICENSE). The OwnKeep name and logos are trademarks and are **not** covered by the code license (see [NOTICE](NOTICE)).

**Stack:** React SPA + Kotlin/Spring Boot API (single `app` image) · PostgreSQL (`db`)

This repository is **OwnKeep Core** (`ownkeep-core`). The hosted SaaS product (landing page, public self-registration, Cloud Run packaging) lives in a separate private repository and builds a derived image on top of `ownkeep-core`.

## Quick start

```sh
cp .env.example .env
# Edit .env — replace every CHANGE_ME with strong random values

docker compose up -d --build
open http://localhost:8080
```

Accounts: set `OWNKEEP_ADMIN_EMAIL` / `OWNKEEP_ADMIN_PASSWORD` in `.env` to bootstrap the first admin; manage other users in the app. Usernames are email addresses. Optional email verification is controlled by `OWNKEEP_EMAIL_VERIFICATION_REQUIRED` (off by default). Never commit `.env`.

Database config is a single `OWNKEEP_DATABASE_URL` (Neon-style `postgresql://user:pass@host/db`).

The Compose stack builds one image (`ownkeep-core:latest`) from the root [Dockerfile](Dockerfile): the SPA is served from `/app/static` and the API JAR supports extension JARs via `LOADER_PATH=/app/extensions`. Postgres stays a separate `db` service.

## Development

```sh
docker compose up -d db

cd api && ./gradlew bootRun
cd web && npm ci && npm run dev
```

The Vite dev server proxies `/api` to the API on port 8080 and strips the `/api` prefix. In the unified production image, Spring strips `/api` the same way.

## Useful commands

```sh
docker compose ps
docker compose logs -f app db
docker compose down          # keeps data volumes
```

- API health: `GET /api/health`
- OpenAPI: `GET /api/openapi.json`

## Documentation

- [Application specification](ownkeep-spec.md) — product scope, data model, API, and UI behavior
- [OpenMediaVault deployment](README_OMV.md) — OMV Compose stack with public images
- [API notes](api/README.md)
- [Web client notes](web/README.md)

## Image publishing

CI on `main` builds and pushes the Docker Hub image `rzarajczyk/ownkeep-core` (plus version/timestamp tags). It does not deploy anywhere. Hosted Cloud Run deploys are owned by the private `ownkeep-saas` repository (triggered on SaaS pushes and after each core image publish).

## Security

- Notes and attachments are zero-knowledge encrypted in the browser; the API stores opaque ciphertext only
- On first unlock, each user receives a **recovery key** — store it offline. Admin password reset clears the password wrap; recovery is required to regain vault access
- Configure secrets only in `.env` (see `.env.example`)
- Use HTTPS and a reverse proxy in production; bind `OWNKEEP_PORT=127.0.0.1:8080` if the proxy runs on the same host
- Rotate any credential that was ever committed or shared
