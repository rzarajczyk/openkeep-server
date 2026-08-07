locals {
  secret_values = {
    database-url      = var.database_url
    database-user     = var.database_user
    database-password = var.database_password
    admin-username    = var.admin_username
    admin-password    = var.admin_password
  }
}

resource "google_secret_manager_secret" "openkeep" {
  for_each = local.secret_values

  secret_id = "openkeep-${each.key}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "openkeep" {
  for_each = local.secret_values

  secret      = google_secret_manager_secret.openkeep[each.key].id
  secret_data = each.value
}
