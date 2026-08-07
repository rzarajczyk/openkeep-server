variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "openkeep-504806"
}

variable "region" {
  description = "GCP region for Cloud Run and the attachments bucket"
  type        = string
  default     = "europe-west1"
}

variable "image" {
  description = "Container image for Cloud Run"
  type        = string
  default     = "docker.io/rzarajczyk/openkeep:latest"
}

variable "github_repository" {
  description = "GitHub repository (owner/name) allowed to deploy via WIF"
  type        = string
  default     = "rzarajczyk/openkeep-server"
}

variable "database_url" {
  description = "JDBC URL for Spring (OPENKEEP_DATABASE_URL), without embedded credentials"
  type        = string
  sensitive   = true
}

variable "database_user" {
  description = "Database username"
  type        = string
  sensitive   = true
}

variable "database_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "admin_username" {
  description = "Bootstrap admin username"
  type        = string
}

variable "admin_password" {
  description = "Bootstrap admin password"
  type        = string
  sensitive   = true
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "openkeep"
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "1Gi"
}
