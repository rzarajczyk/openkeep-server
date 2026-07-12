# OpenKeep API

Kotlin/JDK 21 Spring Boot API backed by PostgreSQL.

## Run locally

Start PostgreSQL, then provide at least one configured user:

```sh
export OPENKEEP_USERS_JSON='[{"login":"admin","password":"change-this-password"}]'
./gradlew bootRun
```

The default database is `jdbc:postgresql://localhost:5432/openkeep` with username and password
`openkeep`. Override it with `OPENKEEP_DATABASE_URL`, `OPENKEEP_DATABASE_USER`, and
`OPENKEEP_DATABASE_PASSWORD`.

The API listens on port 8080. OpenAPI is available at `/openapi.json` and health at `/health`.

## Configuration

- `OPENKEEP_USERS_JSON` — required JSON array of `{login,password}` objects
- `OPENKEEP_TOKEN_TTL` — bearer-token lifetime, default `30d`
- `OPENKEEP_MAX_SYNC_LIMIT` — maximum notes/search page size, default `200`
- `OPENKEEP_ATTACHMENT_STORAGE_ROOT` — attachment volume path, default `./data/attachments`
- `OPENKEEP_ATTACHMENT_MAX_FILE_SIZE` — application-level upload limit in bytes, default 25 MiB
- `OPENKEEP_MULTIPART_MAX_FILE_SIZE` — servlet upload limit, default `25MB`
- `OPENKEEP_ATTACHMENT_PER_USER_QUOTA` — per-user attachment quota in bytes, default 1 GiB
- `OPENKEEP_CORS_ALLOWED_ORIGINS` — comma-separated browser origins; defaults to local dev origins

Run verification with `./gradlew clean test bootJar`. Database integration tests use
Testcontainers and are skipped automatically only when Docker is unavailable.
