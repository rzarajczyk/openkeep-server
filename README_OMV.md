# OwnKeep on OpenMediaVault

Run OwnKeep as an OMV Compose stack using the public web image and a bind-mounted data directory.

**Images:** `rzarajczyk/ownkeep-web` · `rzarajczyk/ownkeep-api` · `postgres:18-alpine`

> **Note:** CI on `main` now publishes only the unified `rzarajczyk/ownkeep` image.
> This OMV dual-image stack is unchanged and keeps using the last published
> `ownkeep-web` / `ownkeep-api` tags until the NAS deploy is migrated.

Replace every `choose_a_strong_password` placeholder before deploying. Generate secrets with:

```sh
openssl rand -base64 32
```

## Compose file

Paste this into the OMV Compose plugin. OMV replaces `CHANGE_TO_COMPOSE_DATA_PATH` with your stack data path and `${{ tz }}` with the system timezone.

Service names must be `web` and `api` — the web image proxies `/api` to the hostname `api` on the Compose network. The database service is named `ownkeep-postgres`.

```yaml
services:
  web:
    image: rzarajczyk/ownkeep-web:latest
    container_name: ownkeep-web
    ports:
      - "7001:8080"
    depends_on:
      - api
    restart: unless-stopped

  api:
    image: rzarajczyk/ownkeep-api:latest
    container_name: ownkeep-api
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://ownkeep-postgres:5432/ownkeep
      - SPRING_DATASOURCE_USERNAME=ownkeep
      - SPRING_DATASOURCE_PASSWORD=choose_a_strong_database_password
      - SPRING_JPA_OPEN_IN_VIEW=false
      - SPRING_SERVLET_MULTIPART_MAX_FILE_SIZE=26214400B
      - SPRING_SERVLET_MULTIPART_MAX_REQUEST_SIZE=27262976B
      - SERVER_FORWARD_HEADERS_STRATEGY=framework
      - OWNKEEP_ADMIN_USERNAME=your_admin_login
      - OWNKEEP_ADMIN_PASSWORD=choose_a_strong_admin_password
      - OWNKEEP_TOKEN_TTL=PT24H
      - OWNKEEP_ATTACHMENT_STORAGE_ROOT=/data/attachments
      - OWNKEEP_ATTACHMENT_MAX_FILE_SIZE=26214400
      - OWNKEEP_ATTACHMENT_PER_USER_QUOTA=1073741824
      - TZ=${{ tz }}
    volumes:
      - CHANGE_TO_COMPOSE_DATA_PATH/ownkeep/attachments:/data/attachments
    depends_on:
      - ownkeep-postgres
    restart: unless-stopped

  ownkeep-postgres:
    image: postgres:18-alpine
    container_name: ownkeep-postgres
    environment:
      - POSTGRES_DB=ownkeep
      - POSTGRES_USER=ownkeep
      - POSTGRES_PASSWORD=choose_a_strong_database_password
      - TZ=${{ tz }}
    volumes:
      - CHANGE_TO_COMPOSE_DATA_PATH/ownkeep/postgres:/var/lib/postgresql
    shm_size: 128mb
    restart: unless-stopped
```

Use the same value for both `POSTGRES_PASSWORD` entries. `OWNKEEP_ADMIN_USERNAME` / `OWNKEEP_ADMIN_PASSWORD` bootstrap the first admin on first start; create additional users from **Manage users** in the app.

## Before first start

The API container runs as UID `10001` and must write to the attachments bind mount. Create the directory and fix ownership **before** starting the stack (otherwise the API crashes with `AccessDeniedException: /data/attachments/.tmp`):

```sh
sudo mkdir -p CHANGE_TO_COMPOSE_DATA_PATH/ownkeep/attachments
sudo chown -R 10001:10001 CHANGE_TO_COMPOSE_DATA_PATH/ownkeep/attachments
```

## After deploy

Open the app at `http://<your-omv-ip>:7001`. The web container listens on port 8080 internally; only the host mapping uses 7001.

## Troubleshooting

**`AccessDeniedException: /data/attachments/.tmp` in ownkeep-api logs**

The attachments directory is not writable by the API user (UID `10001`). On the OMV host:

```sh
sudo mkdir -p CHANGE_TO_COMPOSE_DATA_PATH/ownkeep/attachments
sudo chown -R 10001:10001 CHANGE_TO_COMPOSE_DATA_PATH/ownkeep/attachments
docker compose ... restart api
```

**`Invalid login or password` in the browser, but `curl` to `/api/auth/login` works**

The web container serves `/api` on the same origin as the UI. Verify the admin bootstrap credentials (or a user created in **Manage users**):

```sh
docker exec ownkeep-api printenv OWNKEEP_ADMIN_USERNAME
curl -i -X POST http://localhost:7001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"your_admin_login","password":"your_admin_password"}'
```

If `curl` succeeds but the browser still fails, check DevTools → Network for the `POST /api/auth/login` request URL and status. An external reverse proxy must forward `/api` to the web container, not only `/`.

**`host not found in upstream "api"` in ownkeep-web logs**

The API service must be named `api` (not `ownkeep-api`). Docker DNS resolves service names, not `container_name` values. Either rename the service as in the compose file above, or keep your service name and add a network alias:

```yaml
  ownkeep-api:
    ...
    networks:
      default:
        aliases:
          - api
```

## Notes

- The first admin is bootstrapped once from `OWNKEEP_ADMIN_USERNAME` / `OWNKEEP_ADMIN_PASSWORD`. After that, manage users in the app (create, soft-delete, reset password). Env changes on restart do not overwrite an existing admin.
- The web container proxies `/api` to the API service on the Compose network; use one browser origin (for example `http://<your-omv-ip>:7001`).
- PostgreSQL data is stored under `CHANGE_TO_COMPOSE_DATA_PATH/ownkeep/postgres`.
- Attachments are stored under `CHANGE_TO_COMPOSE_DATA_PATH/ownkeep/attachments`. Google Keep Takeout import stages ZIP contents under that same volume (`.imports`) unless you set a dedicated staging root.
- Large Takeout ZIPs need the servlet multipart limit raised above the default 25 MiB (also raise `OWNKEEP_IMPORT_MAX_UPLOAD_SIZE` if you change the application-level cap).
