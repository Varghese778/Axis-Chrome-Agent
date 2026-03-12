terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "containerregistry.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# Firestore database
resource "google_firestore_database" "main" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.apis]
}

# Cloud Run service
resource "google_cloud_run_v2_service" "backend" {
  name     = "axis-backend"
  location = var.region

  template {
    containers {
      image = "gcr.io/${var.project_id}/axis-backend:latest"
      ports { container_port = 8080 }
      resources { limits = { memory = "1Gi", cpu = "1" } }
    }
    scaling { min_instance_count = 1 }
  }
  depends_on = [google_project_service.apis]
}

# Public access
resource "google_cloud_run_service_iam_member" "public" {
  location = google_cloud_run_v2_service.backend.location
  service  = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
