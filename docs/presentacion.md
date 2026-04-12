# Documentación del Taller — Microservices Demo en GKE

> Guía completa para armar la presentación. Cada sección indica qué explicar,
> qué mostrar en pantalla y dónde tomar la captura para las diapositivas.

---

## 1. Metodología ágil elegida: Scrum

**Por qué Scrum:**
El proyecto tiene entregables incrementales claros (CI primero, luego CD, luego patrones),
roles diferenciados (desarrollador vs operaciones) y revisión continua — encaja naturalmente
con sprints cortos. Usamos el tablero Kanban de GitHub Projects para hacer seguimiento.

**Captura para diapositiva:**
- Ir a: `https://github.com/Alexis1661/microservices-demo/projects`
- Capturar el tablero con las columnas: Backlog / In Progress / Done
- Mostrar tarjetas reales de las tareas que hicimos (CI pipelines, GKE, patrones)

---

## 2. Estrategia de ramificación

### Para desarrolladores (`feature/*`)
```
develop ← feature/cache-aside-pattern   (nueva funcionalidad)
develop ← feature/sidecar-pattern       (nueva funcionalidad)
main    ← develop                        (release, vía PR)
```

### Para operaciones (`infra/*`)
```
main ← infra/agregar-cluster-gke        (terraform + cluster GKE)
main ← fix/terraform-backend            (correcciones de infra)
```

**Por qué esta separación:**
- Los cambios de código nunca tocan `main` directamente — siempre pasan por `develop`
- Los cambios de infraestructura tienen su propio carril (`infra/*`) para no bloquear desarrollo
- `main` es el único branch que despliega a producción

**Captura para diapositiva:**
- Ir a: `https://github.com/Alexis1661/microservices-demo/network` (pestaña Insights → Network)
- Capturar el grafo de ramas
- Alternativa: `https://github.com/Alexis1661/microservices-demo/branches`

---

## 3. Patrones de diseño cloud

### Patrón 1: Event-Driven Architecture (documentado)

**Qué es:** Los servicios se comunican vía eventos/mensajes a través de Kafka, no por llamadas directas entre ellos.

**Dónde está en el código:**
- `vote/src/.../VoteController.java` línea ~63: `kafkaTemplate.send("votes", voter, vote)`
- `worker/main.go` línea ~63: `consumer.Messages()` — consume del topic `votes`

**Por qué lo elegimos:**
- Desacoplamiento total: si `worker` cae, los votos se acumulan en Kafka sin perderlos
- Escalabilidad: puedes tener múltiples workers consumiendo en paralelo
- Auditoría: el log de Kafka es un registro inmutable de todos los votos

**Captura para diapositiva:**
- Ir a: `https://github.com/Alexis1661/microservices-demo/blob/main/worker/main.go`
- Capturar las líneas del consumer de Kafka (aprox línea 55-85)

---

### Patrón 2: Database per Service (documentado)

**Qué es:** Cada servicio tiene su propia base de datos. Ningún otro servicio puede acceder directamente a la DB de otro.

**Dónde está en el código:**
- Solo `worker/main.go` tiene la conexión a PostgreSQL (`host=postgresql`)
- `result/server.js` NO tiene acceso directo a PostgreSQL — lee vía caché/WebSocket
- `vote` NO tiene base de datos propia

**Por qué lo elegimos:**
- Independencia de despliegue: puedes cambiar la DB de worker sin afectar a result
- Sin acoplamiento de esquema: cada servicio evoluciona su modelo de datos solo
- Alineado con los principios de microservicios

**Captura para diapositiva:**
- Diagrama de arquitectura: `architecture.png` en la raíz del repo

---

### Patrón 3: Cache-Aside (IMPLEMENTADO en `result`)

**Qué es:** La aplicación gestiona la caché manualmente. Antes de ir a la fuente de datos (PostgreSQL), checa la caché (Redis). Si está (HIT), lo sirve directo. Si no (MISS), consulta la DB, guarda en caché y responde.

```
Petición
   │
   ▼
┌─────────┐   HIT   ┌──────────────────────────┐
│  Redis  │────────►│ Responder con dato cacheado│
└─────────┘         └──────────────────────────┘
   │ MISS
   ▼
┌─────────────┐     ┌──────────────────────────┐
│ PostgreSQL  │────►│ Guardar en Redis (TTL 5s) │
└─────────────┘     └──────────────────────────┘
```

**Dónde está en el código:**
- `result/server.js` — función `getVotes()` (líneas ~55-95)
- `infrastructure/templates/redis.yaml` — Deployment + Service de Redis

**Por qué lo elegimos:**
- `result` consulta la DB **cada 1 segundo** para todos los clientes conectados. Sin caché, a 100 usuarios = 100 queries/seg a PostgreSQL. Con Cache-Aside = 1 query cada 5 segundos sin importar cuántos usuarios haya.
- Control total sobre el TTL (podemos ajustarlo sin cambiar la DB)
- Fácil de demostrar: los logs muestran HIT/MISS en tiempo real

**Captura para diapositiva:**
- Abrir terminal y correr: `kubectl logs -n microservices-demo deploy/result -f`
- Capturar la pantalla mostrando la secuencia: MISS → HIT → HIT → HIT → HIT → MISS

---

### Patrón 4: Sidecar (IMPLEMENTADO en `worker`)

**Qué es:** Se agrega un container adicional ("sidecar") en el mismo Pod de Kubernetes junto al container principal. Comparten recursos (volúmenes, red local). El sidecar provee capacidades de infraestructura (observabilidad, logging, proxy) sin modificar el código de negocio principal.

```
┌──────────────────── Pod: worker ──────────────────────┐
│                                                        │
│  ┌─────────────────────┐    volumen     ┌───────────┐ │
│  │  worker (Go)        │──/health-data──│  sidecar  │ │
│  │  - consume Kafka    │  status.json   │  (Python) │ │
│  │  - escribe a PG     │               │  GET /health│ │
│  │  - escribe status   │               │  :8080    │ │
│  └─────────────────────┘               └───────────┘ │
└────────────────────────────────────────────────────────┘
```

**Dónde está en el código:**
- `worker/main.go` — struct `WorkerStatus` + función `writeStatus()` + llamada en el consumer
- `worker/chart/templates/deployment.yaml` — sección `containers` con dos containers + `volumes`

**Por qué lo elegimos:**
- `worker` es un proceso Go puro de Kafka — no tiene servidor HTTP. Agregar health checks directamente implicaría mezclar lógica de negocio con observabilidad.
- El sidecar puede ser actualizado (mejorar el health check, agregar métricas Prometheus) sin recompilar el worker
- Demuestra el concepto "separation of concerns" a nivel de infraestructura

**Captura para diapositiva:**
- Correr: `kubectl get pods -n microservices-demo -l app=worker`
- Capturar que muestra `2/2` en la columna READY
- Correr: `kubectl exec -n microservices-demo deploy/worker -c health-sidecar -- wget -qO- localhost:8080/health`
- Capturar el JSON de respuesta

---

## 4. Diagrama de arquitectura

**Qué incluir en el diagrama (para la diapositiva):**

```
GitHub                    GCP
──────                    ───────────────────────────────────────
                          Artifact Registry
Code push                 us-central1-docker.pkg.dev
    │                            ▲
    ▼                            │ docker push
GitHub Actions CI ───────────────┘
(vote/worker/result)
    │
    ▼                     GKE Autopilot Cluster
GitHub Actions CD ──────► microservices-cluster (us-central1)
(Helm deploy)             ┌──────────────────────────────────┐
                          │  namespace: microservices-demo   │
Terraform                 │                                  │
    │                     │  vote:8080 ──kafka──► worker     │
    ▼                     │     (LoadBalancer)      │        │
GKE Cluster creation      │                         ▼        │
Artifact Registry         │                    postgresql    │
(infra-deploy.yml)        │                                  │
                          │  result:80 ◄──redis──────────────│
                          │  (LoadBalancer)                  │
                          └──────────────────────────────────┘
                          
                          GCS Bucket
                          terraform state
```

**Captura para diapositiva:**
- Ir a: GCP Console → Kubernetes Engine → Workloads
  `https://console.cloud.google.com/kubernetes/workload/overview?project=project-e17fa96d-a2f8-4371-ad2`
- Capturar la lista de workloads corriendo
- También: GCP Console → Artifact Registry → `microservices-demo`
  `https://console.cloud.google.com/artifacts/docker/project-e17fa96d-a2f8-4371-ad2/us-central1/microservices-demo`

---

## 5. Pipelines CI/CD

### Pipelines de desarrollo (CI)

| Pipeline | Archivo | Trigger | Pasos |
|---|---|---|---|
| CI - Vote | `.github/workflows/vote-ci.yml` | push a `vote/**` | Java 22 → Maven build → Maven test → Docker build → push a AR |
| CI - Worker | `.github/workflows/worker-ci.yml` | push a `worker/**` | Go build → Docker build → push a AR |
| CI - Result | `.github/workflows/result-ci.yml` | push a `result/**` | npm install → Mocha tests → Docker build → push a AR |

### Pipeline de infraestructura (CD infra)

| Pipeline | Archivo | Trigger | Pasos |
|---|---|---|---|
| CD - Infrastructure | `.github/workflows/infra-deploy.yml` | push a `terraform/**` en main o `infra/*` | Auth GCP → terraform init → fmt check → import recursos → plan → apply |

### Pipeline de despliegue (CD app)

| Pipeline | Archivo | Trigger | Pasos |
|---|---|---|---|
| CD - Deploy to GKE | `.github/workflows/cd-deploy.yml` | CI exitoso en main / manual | Auth GCP → get-gke-credentials → helm upgrade infrastructure → helm upgrade vote/worker/result → verificar pods |

**Captura para diapositiva:**
- Ir a: `https://github.com/Alexis1661/microservices-demo/actions`
- Capturar los últimos runs exitosos (checkmarks verdes)
- Hacer clic en un run de CD - Deploy to GKE y capturar los steps expandidos

---

## 6. Implementación de infraestructura

**Qué incluir:**

- **Terraform** gestiona:
  - `google_project_service` — habilita las APIs de GCP necesarias
  - `google_artifact_registry_repository` — repositorio Docker
  - `data.google_container_cluster` — referencia al cluster GKE
  - Backend remoto en GCS para estado compartido

- **GKE Autopilot:** no gestiona nodos manualmente — GCP los provisiona automáticamente según la demanda

- **Workload Identity Federation:** los workflows de GitHub Actions se autentican con GCP sin claves JSON — más seguro

**Captura para diapositiva:**
- Ir a: GCP Console → IAM → Service Accounts
  `https://console.cloud.google.com/iam-admin/serviceaccounts?project=project-e17fa96d-a2f8-4371-ad2`
- Capturar `github-actions-sa` con sus roles
- Ir a: `https://github.com/Alexis1661/microservices-demo/blob/main/terraform/main.tf`
- Capturar el contenido del archivo terraform

---

## 7. Tablero Kanban (GitHub Projects)

Si aún no tienen el tablero creado, créenlo ahora:

1. Ir a `https://github.com/Alexis1661/microservices-demo/projects`
2. Click **New project** → **Board**
3. Columnas sugeridas: **Backlog / In Progress / In Review / Done**
4. Crear tarjetas para cada tarea completada:
   - ✅ Configurar GCP (Artifact Registry, SA, WIF)
   - ✅ Estrategia de branches (main/develop/feature/infra)
   - ✅ CI - Vote Service
   - ✅ CI - Worker Service
   - ✅ CI - Result Service
   - ✅ CD - Infrastructure (Terraform + GKE)
   - ✅ CD - Deploy to GKE (Helm)
   - ✅ Patrón Cache-Aside (result + Redis)
   - ✅ Patrón Sidecar (worker + health sidecar)
   - ✅ Documentación y README

**Captura para diapositiva:**
- Con todas las tarjetas en Done: capturar el tablero completo
- Mostrar el historial de PRs: `https://github.com/Alexis1661/microservices-demo/pulls?q=is%3Apr+is%3Aclosed`

---

## Estructura de la presentación (8 minutos)

| Tiempo | Sección | Quién |
|---|---|---|
| 0:00 – 0:45 | Intro: qué es el proyecto, Scrum como metodología | Cualquiera |
| 0:45 – 1:30 | Estrategia de branches (dev + ops) + tablero Kanban | Cualquiera |
| 1:30 – 3:00 | Pipelines CI/CD: mostrar Actions corriendo en vivo | Tú |
| 3:00 – 4:30 | Infraestructura: Terraform + GKE + GCP Console | Tu compañera |
| 4:30 – 6:30 | Patrones: Cache-Aside (logs en vivo) + Sidecar (exec en vivo) | Ambos |
| 6:30 – 7:30 | Demo live: hacer un cambio → CI → CD → visible en app | Tú |
| 7:30 – 8:00 | Cierre y preguntas | Ambos |
