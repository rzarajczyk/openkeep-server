# OwnKeep

Self-hosted notes app — text and checklist notes, labels, pinning, attachments, search, Google Keep import, and multi-user accounts. A small Google Keep-style alternative you run with Docker.

**Stack:** React SPA + Kotlin/Spring Boot API (single `app` image) · PostgreSQL (`db`)

## Quick start

```sh
cp .env.example .env
# Edit .env — replace every CHANGE_ME with strong random values

docker compose up -d --build
open http://localhost:8080
```

Accounts: set `OWNKEEP_ADMIN_USERNAME` / `OWNKEEP_ADMIN_PASSWORD` in `.env` to bootstrap the first admin; manage other users in the app. Never commit `.env`.

Database config is a single `OWNKEEP_DATABASE_URL` (Neon-style `postgresql://user:pass@host/db`). Older `POSTGRES_*` variables are no longer read — see [.env.example](.env.example).

The Compose stack builds one image (`ownkeep:latest`) from the root [Dockerfile](Dockerfile): the SPA is embedded in the API JAR and served by Spring on port 8080. Postgres stays a separate `db` service.

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

CI on `main` builds and pushes the unified Docker Hub image `rzarajczyk/ownkeep` (plus a timestamp tag). Separate `ownkeep-api` / `ownkeep-web` image publishes are paused; the OMV/NAS dual-image stack in [README_OMV.md](README_OMV.md) continues to use the last published dual tags until that stack is migrated.

## Security

- Notes and attachments are zero-knowledge encrypted in the browser; the API stores opaque ciphertext only
- On first unlock, each user receives a **recovery key** — store it offline. Admin password reset clears the password wrap; recovery is required to regain vault access
- V5 schema migration wipes existing note/attachment rows (dev cutover). Clear the attachment volume when upgrading from pre-ZK builds
- Configure secrets only in `.env` (see `.env.example`)
- Use HTTPS and a reverse proxy in production; bind `OWNKEEP_PORT=127.0.0.1:8080` if the proxy runs on the same host
- Rotate any credential that was ever committed or shared
