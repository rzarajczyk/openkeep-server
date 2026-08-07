# OwnKeep on GCP (OpenTofu + Cloud Run)

Provisions GCS (attachments), Secret Manager, Cloud Run, and GitHub Actions
Workload Identity Federation for project `ownkeep-net` in **europe-west1**.

Postgres stays on **Neon** (or any Postgres). Cloudflare custom domains are out of scope here.

## Prerequisites

1. [OpenTofu](https://opentofu.org/) `>= 1.6` (`tofu` on `PATH`)
2. `gcloud` authenticated (`gcloud auth application-default login` and access to the project)
3. Billing enabled on `ownkeep-net` (already linked)
4. A Neon (or other) Postgres database — prefer an **EU** region
5. Docker Hub image `rzarajczyk/ownkeep` (published by CI on `main`)

## Configure `.env`

From the repo root:

```sh
cp .env.example .env
# Edit .env — set Neon + admin values (no CHANGE_ME left)
```

Required for `setup.sh`:

| Variable | Purpose |
|---|---|
| `GCP_PROJECT_ID` | GCP project (`ownkeep-net`) |
| `GCP_REGION` | Cloud Run + GCS region (`europe-west1`) |
| `OWNKEEP_DATABASE_URL` | Neon connection string (paste as-is; `postgres://…`) |
| `OWNKEEP_ADMIN_USERNAME` | Bootstrap admin login |
| `OWNKEEP_ADMIN_PASSWORD` | Bootstrap admin password |

Optional:

| Variable | Default |
|---|---|
| `OWNKEEP_IMAGE` | `docker.io/rzarajczyk/ownkeep:latest` |

## Apply infra

```sh
./infra/gcp/setup.sh
```

This runs `tofu init` + `tofu apply`, then prints:

- Cloud Run URL
- Attachments bucket name
- GitHub Actions secrets to configure

## GitHub Actions secrets

After the first successful apply, add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Source |
|---|---|
| `GCP_PROJECT_ID` | OpenTofu output `project_id` |
| `GCP_REGION` | `europe-west1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | OpenTofu output `workload_identity_provider` |
| `GCP_SERVICE_ACCOUNT` | OpenTofu output `deploy_service_account` |

Existing Docker Hub secrets (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`) stay as they are.

On each green `main` push, CI builds/pushes the image to Docker Hub and, when the GCP secrets are present, updates Cloud Run to that image tag. OpenTofu remains the source of truth for service env, secrets, and IAM (`ignore_changes` on the container image).

Workload Identity accepts OIDC only from `refs/heads/main` on the configured repository (other branches/PRs cannot impersonate the deploy SA).

Until GCP secrets are set, the Docker job still publishes to Docker Hub and skips the deploy steps.

Re-running `./infra/gcp/setup.sh` after changing Neon or admin credentials updates Secret Manager and forces a new Cloud Run revision (via a secrets hash annotation) so the service picks up the new values.

## Manual redeploy

```sh
gcloud run services update ownkeep \
  --project=ownkeep-net \
  --region=europe-west1 \
  --image=docker.io/rzarajczyk/ownkeep:latest
```

## Cost note

Cloud Run Always Free is US-only. `europe-west1` is pay-as-you-go; scale-to-zero keeps light personal use cheap.

## Follow-ups

- Cloudflare DNS / custom domain in front of Cloud Run
- Remote OpenTofu state in a GCS bucket
- Neon project creation automation (currently manual)
