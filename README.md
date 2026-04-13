# Microservices Demo — GKE + GitOps

Aplicación de votación en tiempo real desplegada en **Google Kubernetes Engine (GKE Autopilot)** usando una pipeline CI/CD completa con GitHub Actions y Terraform.

## Link video Demo:
https://youtu.be/Ywfcm5IxocQ

##Link Presentacion:
https://gamma.app/docs/Cloud-Pipeline-Construction-qlu017r78ycb0qw

## Arquitectura


| Servicio | Tecnología | Función |
|---|---|---|
| **vote** | Java 22 / Spring Boot | Frontend de votación (Tacos vs Burritos) |
| **worker** | Go 1.24 | Consume votos de Kafka, persiste en PostgreSQL |
| **result** | Node.js 18 | Muestra resultados en tiempo real vía WebSocket |
| **Kafka** | Apache Kafka 3.7 (KRaft) | Cola de mensajes entre vote y worker |
| **PostgreSQL** | PostgreSQL 16 | Base de datos de votos |
| **Redis** | Redis 7 | Caché de resultados (Cache-Aside Pattern) |

## URLs en producción (GKE)

| App | URL |
|---|---|
| Votar | http://34.132.209.134:8080 |
| Resultados | http://34.63.41.74 |

## Infraestructura (GCP)

- **Cluster:** GKE Autopilot `microservices-cluster` — `us-central1`
- **Registry:** Artifact Registry `us-central1-docker.pkg.dev/project-e17fa96d-a2f8-4371-ad2/microservices-demo`
- **Estado Terraform:** GCS bucket `microservices-demo-tfstate-577656732050`
- **Auth CI/CD:** Workload Identity Federation (sin claves JSON)

## Estrategia de ramificación

```
main          → producción, protegida, solo merge vía PR
develop       → integración, base para features
feature/*     → desarrollo de funcionalidades (desarrolladores)
infra/*       → cambios de infraestructura (operaciones)
fix/*         → correcciones urgentes
```

## Pipelines

| Pipeline | Trigger | Qué hace |
|---|---|---|
| `CI - Vote Service` | push a `vote/**` en develop/main | Maven build + test + Docker push |
| `CI - Worker Service` | push a `worker/**` en develop/main | Go build + Docker push |
| `CI - Result Service` | push a `result/**` en develop/main | npm test + Docker push |
| `CD - Infrastructure` | push a `terraform/**` en infra/* o main | Terraform plan/apply en GKE |
| `CD - Deploy to GKE` | después de cualquier CI exitoso en main | Helm deploy al cluster |

## Patrones de diseño cloud implementados

### 1. Event-Driven Architecture
`vote` publica mensajes en Kafka. `worker` los consume de forma asíncrona. Los servicios no se conocen entre sí — están desacoplados por el broker.

### 2. Database per Service
`worker` es el único servicio con acceso a PostgreSQL. `result` no tiene acceso directo a la DB — lee a través de WebSocket/caché.

### 3. Cache-Aside Pattern *(implementado en result)*
Antes de consultar PostgreSQL, `result` checa Redis. Si el dato está en caché (HIT) lo sirve directo. Si no (MISS), consulta la DB y guarda en Redis con TTL de 5 segundos.

```
request → Redis HIT → respuesta inmediata
        → Redis MISS → PostgreSQL → guardar en Redis → respuesta
```

### 4. Sidecar Pattern *(implementado en worker)*
El pod de `worker` corre dos containers: el worker principal (Go) y un sidecar (Python) que comparte un volumen. El worker escribe su estado en `/health-data/status.json`; el sidecar lo expone como `GET /health` en el puerto 8080.

```bash
kubectl exec -n microservices-demo deploy/worker -c health-sidecar \
  -- wget -qO- localhost:8080/health
```

## Desarrollo local

```bash
git clone https://github.com/Alexis1661/microservices-demo
cd microservices-demo

# Conectar kubectl al cluster
gcloud container clusters get-credentials microservices-cluster \
  --region us-central1 --project project-e17fa96d-a2f8-4371-ad2

# Ver estado del cluster
kubectl get pods -n microservices-demo
kubectl get services -n microservices-demo

# Logs en tiempo real
kubectl logs -n microservices-demo deploy/result -f      # Cache-Aside hits/misses
kubectl logs -n microservices-demo deploy/worker -f      # mensajes procesados
```

## Metodología ágil

**Scrum** con tablero Kanban en GitHub Projects. Sprints de 1 semana. Roles: 1 desarrollador (vote/worker/result CI) + 1 operaciones (infra/Terraform/GKE).
