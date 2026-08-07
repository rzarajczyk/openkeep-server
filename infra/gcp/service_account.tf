resource "google_service_account" "runtime" {
  account_id   = "openkeep-run"
  display_name = "OpenKeep Cloud Run runtime"
  depends_on   = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "runtime_objects" {
  bucket = google_storage_bucket.attachments.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each = google_secret_manager_secret.openkeep

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_service_account" "deploy" {
  account_id   = "openkeep-gha-deploy"
  display_name = "OpenKeep GitHub Actions deploy"
  depends_on   = [google_project_service.required]
}

resource "google_project_iam_member" "deploy_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_service_account_iam_member" "deploy_act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}
