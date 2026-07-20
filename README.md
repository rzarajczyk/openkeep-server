# OpenKeep

Self-hosted notes app — text and checklist notes, labels, pinning, attachments, search, Google Keep import, and multi-user accounts. A small Google Keep-style alternative you run with Docker.

**Stack:** React SPA (`web`) · Kotlin/Spring Boot API (`api`) · PostgreSQL (`db`)

## Quick start

```sh
cp .env.example .env
# Edit .env — replace every CHANGE_ME with strong random values

docker compose up -d --build
open http://localhost:8080
```

Accounts come from `OPENKEEP_USERS_JSON` in `.env`. Never commit `.env`.

## Development

```sh
docker compose up -d db

cd api && ./gradlew bootRun
cd web && npm ci && npm run dev
```

The Vite dev server proxies `/api` to the API on port 8080, matching the production web container.

## Useful commands

```sh
docker compose ps
docker compose logs -f web api db
docker compose down          # keeps data volumes
```

- API health: `GET /api/health`
- OpenAPI: `GET /api/openapi.json`

## Documentation

- [Application specification](openkeep-spec.md) — product scope, data model, API, and UI behavior
- [OpenMediaVault deployment](README_OMV.md) — OMV Compose stack with public images
- [API notes](api/README.md)
- [Web client notes](web/README.md)

## Security

- Configure secrets only in `.env` (see `.env.example`)
- Use HTTPS and a reverse proxy in production; bind `OPENKEEP_PORT=127.0.0.1:8080` if the proxy runs on the same host
- Rotate any credential that was ever committed or shared
