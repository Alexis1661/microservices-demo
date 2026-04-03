output "cluster_name" {
  description = "Nombre del cluster GKE"
  value       = google_container_cluster.primary.name
}

output "cluster_location" {
  description = "Región del cluster"
  value       = google_container_cluster.primary.location
}

output "artifact_registry_url" {
  description = "URL del Artifact Registry"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/microservices-demo"
}

output "kubectl_command" {
  description = "Comando para conectar kubectl al cluster"
  value       = "gcloud container clusters get-credentials ${google_container_cluster.primary.name} --region ${var.region} --project ${var.project_id}"
}
