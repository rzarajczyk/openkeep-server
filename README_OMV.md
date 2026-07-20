# OpenKeep on OpenMediaVault

Run OpenKeep as an OMV Compose stack using the public web image and a bind-mounted data directory.

**Images:** `rzarajczyk/openkeep-web` · `rzarajczyk/openkeep-api` · `postgres:18-alpine`

Replace every `choose_a_strong_password` placeholder before deploying. Generate secrets with:

```sh
openssl rand -base64 32
```

## Compose file

Paste this into the OMV Compose plugin. OMV replaces `CHANGE_TO_COMPOSE_DATA_PATH` with your stack data path and `${{ tz }}` with the system timezone.

Service names must be `web` and `api` — the web image proxies `/api` to the hostname `api` on the Compose network. The database service is named `openkeep-postgres`.

```yaml
services:
  web:
    image: rzarajczyk/openkeep-web:latest
    container_name: openkeep-web
    ports:
      - "7001:8080"
    depends_on:
      - api
    restart: unless-stopped

  api:
    image: rzarajczyk/openkeep-api:latest
    container_name: openkeep-api
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://openkeep-postgres:5432/openkeep
      - SPRING_DATASOURCE_USERNAME=openkeep
      - SPRING_DATASOURCE_PASSWORD=choose_a_strong_database_password
      - SPRING_JPA_OPEN_IN_VIEW=false
      - SPRING_SERVLET_MULTIPART_MAX_FILE_SIZE=26214400B
      - SPRING_SERVLET_MULTIPART_MAX_REQUEST_SIZE=27262976B
      - SERVER_FORWARD_HEADERS_STRATEGY=framework
      - 'OPENKEEP_USERS_JSON=[{"login":"your_login","password":"choose_a_strong_password"}]'
      - OPENKEEP_TOKEN_TTL=PT24H
      - OPENKEEP_ATTACHMENT_STORAGE_ROOT=/data/attachments
      - OPENKEEP_ATTACHMENT_MAX_FILE_SIZE=26214400
      - OPENKEEP_ATTACHMENT_PER_USER_QUOTA=1073741824
      - TZ=${{ tz }}
    volumes:
      - CHANGE_TO_COMPOSE_DATA_PATH/openkeep/attachments:/data/attachments
    depends_on:
      - openkeep-postgres
    restart: unless-stopped

  openkeep-postgres:
    image: postgres:18-alpine
    container_name: openkeep-postgres
    environment:
      - POSTGRES_DB=openkeep
      - POSTGRES_USER=openkeep
      - POSTGRES_PASSWORD=choose_a_strong_database_password
      - TZ=${{ tz }}
    volumes:
      - CHANGE_TO_COMPOSE_DATA_PATH/openkeep/postgres:/var/lib/postgresql
    shm_size: 128mb
    restart: unless-stopped
```

Use the same value for both `POSTGRES_PASSWORD` entries. Add more users by extending `OPENKEEP_USERS_JSON` with additional `{login,password}` objects. Keep the JSON on one line and wrap the value in single quotes so YAML does not mangle `[` or special characters in passwords.

## Before first start

The API container runs as UID `10001` and must write to the attachments bind mount. Create the directory and fix ownership **before** starting the stack (otherwise the API crashes with `AccessDeniedException: /data/attachments/.tmp`):

```sh
sudo mkdir -p CHANGE_TO_COMPOSE_DATA_PATH/openkeep/attachments
sudo chown -R 10001:10001 CHANGE_TO_COMPOSE_DATA_PATH/openkeep/attachments
```

## After deploy

Open the app at `http://<your-omv-ip>:7001`. The web container listens on port 8080 internally; only the host mapping uses 7001.

## Troubleshooting

**`AccessDeniedException: /data/attachments/.tmp` in openkeep-api logs**

The attachments directory is not writable by the API user (UID `10001`). On the OMV host:

```sh
sudo mkdir -p CHANGE_TO_COMPOSE_DATA_PATH/openkeep/attachments
sudo chown -R 10001:10001 CHANGE_TO_COMPOSE_DATA_PATH/openkeep/attachments
docker compose ... restart api
```

**`Invalid login or password` in the browser, but `curl` to `/api/auth/login` works**

The web container serves `/api` on the same origin as the UI. Verify the credentials match `OPENKEEP_USERS_JSON`:

```sh
docker exec openkeep-api printenv OPENKEEP_USERS_JSON
curl -i -X POST http://localhost:7001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"your_login","password":"your_password"}'
```

If `curl` succeeds but the browser still fails, check DevTools → Network for the `POST /api/auth/login` request URL and status. An external reverse proxy must forward `/api` to the web container, not only `/`.

**`host not found in upstream "api"` in openkeep-web logs**

The API service must be named `api` (not `openkeep-api`). Docker DNS resolves service names, not `container_name` values. Either rename the service as in the compose file above, or keep your service name and add a network alias:

```yaml
  openkeep-api:
    ...
    networks:
      default:
        aliases:
          - api
```

## Notes

- Accounts are defined only via `OPENKEEP_USERS_JSON`. Changing that value and restarting the API creates, updates, or disables users.
- The web container proxies `/api` to the API service on the Compose network; use one browser origin (for example `http://<your-omv-ip>:7001`).
- PostgreSQL data is stored under `CHANGE_TO_COMPOSE_DATA_PATH/openkeep/postgres`.
- Attachments are stored under `CHANGE_TO_COMPOSE_DATA_PATH/openkeep/attachments`. Google Keep Takeout import stages ZIP contents under that same volume (`.imports`) unless you set a dedicated staging root.
- Large Takeout ZIPs need the servlet multipart limit raised above the default 25 MiB (also raise `OPENKEEP_IMPORT_MAX_UPLOAD_SIZE` if you change the application-level cap).
