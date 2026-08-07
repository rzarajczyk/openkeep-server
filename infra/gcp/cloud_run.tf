resource "google_cloud_run_v2_service" "ownkeep" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.runtime.email

    # Hash of secret payloads so rotating Secret Manager values forces a new revision
    # (Cloud Run mounts secret "latest" at deploy time only). Hash only — not the secrets.
    annotations = {
      "ownkeep.net/secrets-hash" = nonsensitive(sha256(jsonencode(local.secret_values)))
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        initial_delay_seconds = 10
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 12
      }

      liveness_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        period_seconds    = 30
        timeout_seconds   = 5
        failure_threshold = 3
      }

      env {
        name  = "OWNKEEP_ATTACHMENT_STORAGE"
        value = "gcs"
      }

      env {
        name  = "OWNKEEP_ATTACHMENT_GCS_BUCKET"
        value = google_storage_bucket.attachments.name
      }

      env {
        name = "OWNKEEP_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ownkeep["database-url"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OWNKEEP_DATABASE_USER"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ownkeep["database-user"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OWNKEEP_DATABASE_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ownkeep["database-password"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OWNKEEP_ADMIN_USERNAME"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ownkeep["admin-username"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "OWNKEEP_ADMIN_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ownkeep["admin-password"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "SERVER_FORWARD_HEADERS_STRATEGY"
        value = "framework"
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_version.ownkeep,
    google_secret_manager_secret_iam_member.runtime_accessor,
    google_storage_bucket_iam_member.runtime_objects,
  ]

  lifecycle {
    ignore_changes = [
      # CI updates the image tag/digest after each successful Docker Hub push.
      client,
      client_version,
      template[0].containers[0].image,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = google_cloud_run_v2_service.ownkeep.project
  location = google_cloud_run_v2_service.ownkeep.location
  name     = google_cloud_run_v2_service.ownkeep.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
