terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.5.0"

  backend "gcs" {
    bucket = "microservices-demo-tfstate-577656732050"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Habilitar APIs necesarias
resource "google_project_service" "container" {
  service            = "container.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# Artifact Registry para las imágenes Docker
resource "google_artifact_registry_repository" "microservices" {
  location      = var.region
  repository_id = "microservices-demo"
  format        = "DOCKER"
  description   = "Repositorio Docker para microservices-demo"

  depends_on = [google_project_service.artifactregistry]
}

# Cluster GKE Autopilot
resource "google_container_cluster" "primary" {
  name     = var.cluster_name
  location = var.region

  enable_autopilot    = true
  deletion_protection = false

  depends_on = [google_project_service.container]
}
