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
`OPENKEEP_DATABASE_PASSWORD`, or the standard Spring Boot variables `SPRING_DATASOURCE_URL`,
`SPRING_DATASOURCE_USERNAME`, and `SPRING_DATASOURCE_PASSWORD` (used by `compose.yaml`).

The API listens on port 8080. OpenAPI is available at `/openapi.json` and health at `/health`.

Markdown for notes is rendered by `MarkdownService` in `Notes.kt`:

- Full body render (TEXT notes / default preview): CommonMark + autolink + GFM
  strikethrough, images (http(s) or attachment filename → `/attachments/{id}`),
  with OWASP sanitization (including `pre` and `hr`).
- Inline render (LIST item `textRendered` and `POST /markdown/preview` with
  `inline: true`): bold, italic, inline code, links, bare URLs, strikethrough —
  no headings, lists, or images.

## Configuration

- `OPENKEEP_USERS_JSON` — required JSON array of `{login,password}` objects
- `OPENKEEP_TOKEN_TTL` — bearer-token lifetime, default `30d`
- `OPENKEEP_MAX_SYNC_LIMIT` — maximum notes/search page size, default `200`
- `OPENKEEP_LOGIN_MAX_ATTEMPTS_PER_IP` — max `/auth/login` attempts per client IP per window, default `10`
- `OPENKEEP_LOGIN_MAX_ATTEMPTS_PER_LOGIN` — max `/auth/login` attempts per login name per window, default `5`
- `OPENKEEP_LOGIN_RATE_LIMIT_WINDOW` — rate-limit window, default `1m`
- `OPENKEEP_ATTACHMENT_STORAGE_ROOT` — attachment volume path, default `./data/attachments`
- `OPENKEEP_ATTACHMENT_MAX_FILE_SIZE` — application-level upload limit in bytes, default 25 MiB
- `OPENKEEP_MULTIPART_MAX_FILE_SIZE` — servlet upload limit, default `25MB`
- `OPENKEEP_ATTACHMENT_PER_USER_QUOTA` — per-user attachment quota in bytes, default 1 GiB
- `OPENKEEP_IMPORT_MAX_UPLOAD_SIZE` — max Google Keep Takeout ZIP size in bytes, default 100 MiB (effective limit is also capped by the servlet multipart max file size)
- `OPENKEEP_IMPORT_MAX_ENTRIES` — max entries in a Takeout ZIP, default `5000`
- `OPENKEEP_IMPORT_MAX_ENTRY_SIZE` — max single ZIP entry size in bytes, default 50 MiB
- `OPENKEEP_IMPORT_MAX_UNCOMPRESSED_SIZE` — max total uncompressed ZIP size in bytes, default 500 MiB
- `OPENKEEP_IMPORT_MAX_WARNINGS` — max stored import warnings, default `100`

Takeout ZIP extraction stages under `<attachment-storage-root>/.imports` by default. To override, set `openkeep.takeout-import.staging-root` (for example `OPENKEEP_TAKEOUT_IMPORT_STAGING_ROOT`).

Run verification with `./gradlew clean test bootJar`. Database integration tests use
Testcontainers and are skipped automatically only when Docker is unavailable.
