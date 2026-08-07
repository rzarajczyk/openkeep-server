resource "random_id" "bucket_suffix" {
  byte_length = 2
}

resource "google_storage_bucket" "attachments" {
  name                        = "${var.project_id}-attachments-${random_id.bucket_suffix.hex}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  depends_on = [google_project_service.required]
}
