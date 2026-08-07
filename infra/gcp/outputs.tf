output "cloud_run_url" {
  description = "HTTPS URL of the OwnKeep Cloud Run service"
  value       = google_cloud_run_v2_service.openkeep.uri
}

output "attachments_bucket" {
  description = "GCS bucket for encrypted attachment blobs"
  value       = google_storage_bucket.attachments.name
}

output "runtime_service_account" {
  value = google_service_account.runtime.email
}

output "deploy_service_account" {
  description = "Set as GitHub Actions secret GCP_SERVICE_ACCOUNT"
  value       = google_service_account.deploy.email
}

output "workload_identity_provider" {
  description = "Set as GitHub Actions secret GCP_WORKLOAD_IDENTITY_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "service_name" {
  value = google_cloud_run_v2_service.openkeep.name
}

output "github_actions_secrets" {
  description = "Values to configure in the GitHub repository"
  value = {
    GCP_PROJECT_ID                = var.project_id
    GCP_REGION                    = var.region
    GCP_SERVICE_ACCOUNT           = google_service_account.deploy.email
    GCP_WORKLOAD_IDENTITY_PROVIDER = google_iam_workload_identity_pool_provider.github.name
  }
}
