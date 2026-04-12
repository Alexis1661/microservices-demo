# Microservices Demo on GKE — Project Documentation

**Repository:** github.com/Alexis1661/microservices-demo  
**Platform:** Google Kubernetes Engine (GKE Autopilot) · us-central1  
**GCP Project:** project-e17fa96d-a2f8-4371-ad2

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Branching Strategy](#2-branching-strategy)
3. [CI/CD Pipelines](#3-cicd-pipelines)
4. [Infrastructure Implementation](#4-infrastructure-implementation)
5. [Cloud Design Patterns](#5-cloud-design-patterns)
6. [Demo Cheat Sheet](#6-demo-cheat-sheet)

---

## 1. Project Overview

A containerized voting application composed of five microservices, deployed to production on GKE Autopilot with a fully automated CI/CD pipeline. Two cloud design patterns were implemented on top of the base application.

### Services

| Service | Language | Role |
|---|---|---|
| `vote` | Java 22 + Spring Boot | Voting frontend (Tacos vs Burritos) |
| `worker` | Go 1.24 | Kafka consumer — persists votes to PostgreSQL |
| `result` | Node.js 18 | Real-time results dashboard via WebSocket |
| `kafka` | Apache Kafka | Message queue between vote and worker |
| `postgresql` | PostgreSQL 15 | Persistent vote storage |
| `redis` | Redis 7 | Cache layer for the result service |

### Architecture

```
Internet
   │
   ├── vote:8080 (LoadBalancer · 34.132.209.134)
   │      │ kafka topic "votes"
   │      ▼
   │   worker ──► postgresql
   │
   └── result:80 (LoadBalancer · 34.63.41.74)
          │ checks redis first
          └──► redis ──► postgresql (on cache MISS)

GitHub Actions CI ──► Artifact Registry (Docker images)
GitHub Actions CD ──► GKE (Helm upgrade)
Terraform         ──► GCS backend (state) + Artifact Registry resource
```

---

## 2. Branching Strategy

### Branch model

```
main          ← production only. Every push triggers CD - Deploy to GKE.
  └── develop ← integration branch. Every push to vote/worker/result triggers CI.
        └── feature/*    ← new application features (merge into develop via PR)
        └── fix/*        ← bug fixes (merge into develop via PR)
main
  └── infra/* ← infrastructure changes only (Terraform, Helm, K8s YAML). Merge directly into main.
```

### Rules

- `main` is protected — no direct pushes. All code reaches it via PR from `develop`.
- `develop` is the CI gate — a broken CI on `develop` never reaches `main`.
- Infrastructure branches (`infra/*`) bypass `develop` because they don't touch application code.
- Feature branches are short-lived — opened, reviewed, merged, deleted.

### Branch examples used in this project

| Branch | Purpose |
|---|---|
| `feature/cache-aside-pattern` | Cache-Aside implementation in result + Redis deployment |
| `feature/sidecar-pattern` | Sidecar health-check container in worker |
| `infra/agregar-cluster-gke` | Initial Terraform cluster setup |
| `infra/terraform-backend` | GCS remote backend for Terraform state |
| `develop` | Integration branch — all CI pipelines run here |
| `main` | Production — triggers CD on every merge |

---

## 3. CI/CD Pipelines

Five GitHub Actions workflows handle the full lifecycle from code push to production deployment.

### CI Pipelines (build, test, push image)

#### CI - Vote Service (`.github/workflows/vote-ci.yml`)

**Trigger:** push to any branch touching `vote/**`

| Step | What happens |
|---|---|
| Checkout | Clone repository |
| Auth GCP | Workload Identity Federation (no JSON keys) |
| Set up Java 22 | Temurin distribution |
| Maven build | `mvn -B package --no-transfer-progress` |
| Maven test | `mvn test` (unit tests) |
| Docker build | Build image from `vote/Dockerfile` |
| Push to Artifact Registry | `us-central1-docker.pkg.dev/.../vote:latest` and `vote:<commit-sha>` |

#### CI - Worker Service (`.github/workflows/worker-ci.yml`)

**Trigger:** push to any branch touching `worker/**`

| Step | What happens |
|---|---|
| Checkout | Clone repository |
| Auth GCP | Workload Identity Federation |
| Set up Go 1.24 | Go toolchain |
| Go build | `go build ./...` |
| Docker build + push | Image pushed to Artifact Registry with `latest` and `<sha>` tags |

#### CI - Result Service (`.github/workflows/result-ci.yml`)

**Trigger:** push to any branch touching `result/**`

| Step | What happens |
|---|---|
| Checkout | Clone repository |
| Auth GCP | Workload Identity Federation |
| Node.js setup | Node 18 |
| npm install | Install dependencies |
| Mocha tests | `npm test` |
| Docker build + push | Image pushed to Artifact Registry |

### CD Pipeline — Infrastructure (`.github/workflows/infra-deploy.yml`)

**Trigger:** push to `main` or `infra/*` branches touching `terraform/**`

| Step | What happens |
|---|---|
| Auth GCP | Workload Identity Federation |
| Terraform init | Initializes GCS remote backend |
| Terraform fmt check | Enforces formatting |
| Terraform import | Idempotent import of existing resources (Artifact Registry) |
| Terraform plan | Shows proposed changes |
| Terraform apply | Applies changes to GCP |

### CD Pipeline — Application Deploy (`.github/workflows/cd-deploy.yml`)

**Trigger:** successful CI on `main` branch, or manual dispatch

| Step | What happens |
|---|---|
| Auth GCP | Workload Identity Federation |
| Get GKE credentials | `gcloud container clusters get-credentials` |
| Helm upgrade — infrastructure | Deploys Kafka, PostgreSQL, Redis, networking |
| Helm upgrade — vote | `helm upgrade --install vote` with `--wait --timeout 8m` |
| Helm upgrade — worker | Same pattern |
| Helm upgrade — result | Same pattern |
| Verify pods | `kubectl get pods -n microservices-demo` |

### Authentication: Workload Identity Federation

GitHub Actions authenticates with GCP **without any JSON service account keys**. Instead:

1. A Workload Identity Pool is configured in GCP linked to the GitHub repository.
2. The GitHub Actions OIDC token is exchanged for a short-lived GCP access token.
3. The `github-actions-sa` service account has the minimum required roles:
   - `roles/artifactregistry.writer` — push Docker images
   - `roles/container.developer` — deploy to GKE
   - `roles/iam.workloadIdentityUser` — allow the federation exchange

---

## 4. Infrastructure Implementation

### Terraform

All infrastructure is declared as code in the `terraform/` directory and managed by the `infra-deploy.yml` pipeline.

**Resources managed by Terraform:**

| Resource | Type | Purpose |
|---|---|---|
| GCP APIs | `google_project_service` | Enables container, artifactregistry, iam APIs |
| Artifact Registry | `google_artifact_registry_repository` | Docker image repository |
| GKE cluster | `data.google_container_cluster` | Read-only reference (cluster pre-exists) |

**Remote backend:**

```hcl
terraform {
  backend "gcs" {
    bucket = "microservices-demo-tfstate-577656732050"
    prefix = "terraform/state"
  }
}
```

State is stored in a GCS bucket, enabling shared access and preventing conflicts when multiple pipeline runs execute concurrently.

### GKE Autopilot

- **Cluster:** `microservices-cluster` · `us-central1`
- **Mode:** Autopilot — GCP manages nodes, scaling, and patching automatically. No node pools to configure.
- **Namespace:** `microservices-demo`

### Helm Charts

Each service has its own Helm chart under `<service>/chart/`. The CD pipeline runs `helm upgrade --install` for each, enabling:
- Zero-downtime rolling updates
- Easy rollback with `helm rollback`
- Environment-specific configuration via `--set`

### Kubernetes Services

| Service | Type | External IP |
|---|---|---|
| `vote` | LoadBalancer | `34.132.209.134:8080` |
| `result` | LoadBalancer | `34.63.41.74:80` |
| `kafka` | ClusterIP | Internal only |
| `postgresql` | ClusterIP | Internal only |
| `redis` | ClusterIP | Internal only |

---

## 5. Cloud Design Patterns

Two cloud design patterns were selected and fully implemented on the base application.

### Pattern 1: Cache-Aside

**Implemented in:** `result/server.js` + `infrastructure/templates/redis.yaml`

**Problem:** The `result` service polls PostgreSQL every second for every connected client. At 100 concurrent users, that is 100 queries per second to PostgreSQL — unsustainable.

**Solution:** Before querying PostgreSQL, check Redis. If the data is there (HIT), serve it directly without touching the database. If not (MISS), query PostgreSQL, store the result in Redis with a 5-second TTL, and respond.

```
Request
   │
   ▼
Redis.get(CACHE_KEY)
   ├── HIT  ──► emit scores to client  (no DB query)
   │
   └── MISS ──► PostgreSQL query
                   │
                   ▼
               Redis.setex(CACHE_KEY, 5, result)
                   │
                   ▼
               emit scores to client
```

**Key code — `result/server.js`:**

```javascript
const CACHE_KEY = 'vote_scores';
const CACHE_TTL_SECONDS = 5;

async function getVotes(client) {
  const cached = await redis.get(CACHE_KEY);

  if (cached) {
    console.log('[cache] HIT — serving scores from Redis');
    io.sockets.emit('scores', cached);
    setTimeout(() => getVotes(client), 1000);
    return;
  }

  console.log('[cache] MISS — querying PostgreSQL');
  client.query('SELECT vote, COUNT(id) AS count FROM votes GROUP BY vote', async (err, result) => {
    const json = JSON.stringify(buildScores(result.rows));
    await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, json);
    io.sockets.emit('scores', json);
    setTimeout(() => getVotes(client), 1000);
  });
}
```

**Result:** Maximum 12 PostgreSQL queries per minute regardless of how many users are connected (~80% reduction in DB load under normal usage).

**Observable in logs:**
```
kubectl logs -n microservices-demo deploy/result -f

[cache] MISS — querying PostgreSQL
[cache] Stored in Redis (TTL=5s)
[cache] HIT — serving scores from Redis
[cache] HIT — serving scores from Redis
[cache] HIT — serving scores from Redis
[cache] HIT — serving scores from Redis
[cache] MISS — querying PostgreSQL
```

---

### Pattern 2: Sidecar

**Implemented in:** `worker/main.go` + `worker/chart/templates/deployment.yaml`

**Problem:** The `worker` service is a pure Go process that consumes Kafka messages and writes to PostgreSQL. It has no HTTP server. Adding a health endpoint directly would mix infrastructure concerns (observability) into business logic.

**Solution:** Deploy a second container (the sidecar) in the same Kubernetes Pod. Both containers share an `emptyDir` volume. The worker writes its status to a JSON file on the shared volume; the sidecar reads that file and serves it over HTTP.

```
┌────────────────────── Pod: worker ──────────────────────────┐
│                                                              │
│  ┌──────────────────────┐  emptyDir   ┌──────────────────┐  │
│  │  worker (Go)         │─/health-data│  health-sidecar  │  │
│  │  · consume Kafka     │  status.json│  (Python)        │  │
│  │  · write PostgreSQL  │────────────►│  GET /health     │  │
│  │  · writeStatus()     │             │  port 8080       │  │
│  └──────────────────────┘             └──────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Key code — `worker/main.go`:**

```go
type WorkerStatus struct {
    Status            string `json:"status"`
    MessagesProcessed int    `json:"messagesProcessed"`
    LastVote          string `json:"lastVote"`
    LastProcessedAt   string `json:"lastProcessedAt"`
}

func writeStatus(count int, lastVote string, status string) {
    os.MkdirAll("/health-data", 0755)
    data, _ := json.Marshal(WorkerStatus{
        Status:            status,
        MessagesProcessed: count,
        LastVote:          lastVote,
        LastProcessedAt:   time.Now().UTC().Format(time.RFC3339),
    })
    os.WriteFile("/health-data/status.json", data, 0644)
}

// Called after every Kafka message processed:
writeStatus(*messageCountStart, string(msg.Value), "healthy")
```

**Key config — `worker/chart/templates/deployment.yaml`:**

```yaml
volumes:
  - name: health-data
    emptyDir: {}

containers:
  - name: worker
    image: {{ .Values.image }}
    volumeMounts:
      - name: health-data
        mountPath: /health-data

  - name: health-sidecar
    image: python:3.11-alpine
    command: ["python3", "-c"]
    args:
      - |
        import http.server, json, os
        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                data = open('/health-data/status.json').read()
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.end_headers()
                self.wfile.write(data.encode())
        http.server.HTTPServer(('',8080), H).serve_forever()
    ports:
      - containerPort: 8080
    volumeMounts:
      - name: health-data
        mountPath: /health-data
```

**Observable in kubectl:**
```bash
# Pod shows 2/2 — both containers running
kubectl get pods -n microservices-demo -l app=worker
# NAME           READY   STATUS    RESTARTS
# worker-xxx     2/2     Running   0

# Query the sidecar health endpoint
kubectl exec -n microservices-demo deploy/worker -c health-sidecar \
  -- wget -qO- localhost:8080/health
# {"status":"healthy","messagesProcessed":42,"lastVote":"a","lastProcessedAt":"2026-04-12T03:00:00Z"}
```

---

## 6. Demo Cheat Sheet

### Before the presentation

```bash
# Connect kubectl to the cluster
gcloud container clusters get-credentials microservices-cluster \
  --region us-central1 --project project-e17fa96d-a2f8-4371-ad2

# Verify all pods are Running
kubectl get pods -n microservices-demo
# worker must show 2/2
```

### Useful commands

```bash
# General status
kubectl get pods -n microservices-demo
kubectl get svc -n microservices-demo

# Cache-Aside: live logs
kubectl logs -n microservices-demo deploy/result -f

# Sidecar: query health endpoint
kubectl exec -n microservices-demo deploy/worker -c health-sidecar \
  -- wget -qO- localhost:8080/health

# Sidecar: confirm 2 containers
kubectl get pods -n microservices-demo -l app=worker

# Pipeline demo: push a code change
git checkout develop
git add vote/src/main/java/com/okteto/vote/controller/VoteController.java
git commit -m "demo: rename vote options"
git push origin develop
# Then: merge to main to trigger CD
git checkout main && git merge develop && git push origin main

# Force pod restart after :latest image update
kubectl rollout restart deployment/vote -n microservices-demo

# Restart everything if something is broken
kubectl rollout restart deployment/vote deployment/worker deployment/result \
  -n microservices-demo
```

### URLs

| What | URL |
|---|---|
| Vote app | `http://34.132.209.134:8080` |
| Result app | `http://34.63.41.74` |
| GitHub Actions | `https://github.com/Alexis1661/microservices-demo/actions` |
| GKE Workloads | `https://console.cloud.google.com/kubernetes/workload/overview?project=project-e17fa96d-a2f8-4371-ad2` |
| GKE Services | `https://console.cloud.google.com/kubernetes/discovery?project=project-e17fa96d-a2f8-4371-ad2` |
| Artifact Registry | `https://console.cloud.google.com/artifacts/docker/project-e17fa96d-a2f8-4371-ad2/us-central1/microservices-demo` |
| result/server.js | `https://github.com/Alexis1661/microservices-demo/blob/main/result/server.js` |
| worker/main.go | `https://github.com/Alexis1661/microservices-demo/blob/main/worker/main.go` |
| deployment.yaml | `https://github.com/Alexis1661/microservices-demo/blob/main/worker/chart/templates/deployment.yaml` |

### If something breaks

| Problem | Fix |
|---|---|
| App not loading | `kubectl get svc -n microservices-demo` — check external IPs |
| CI did not trigger | Go to Actions → CI workflow → **Run workflow** (manual trigger) |
| CD did not trigger | Go to Actions → CD - Deploy to GKE → **Run workflow** |
| Code change not visible in app | `kubectl rollout restart deployment/vote -n microservices-demo` |
| Cache logs not showing | `kubectl rollout restart deploy/result -n microservices-demo` |
| Sidecar not responding | `kubectl rollout restart deploy/worker -n microservices-demo` |
