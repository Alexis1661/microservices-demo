# Guía de Demo en Vivo

> Ensaya esto al menos dos veces antes de la presentación.
> Abre TODAS las pestañas con anticipación — no navegues en vivo si puedes evitarlo.
> Objetivo: 8 minutos fluidos.

---

## Preparación previa (hacer ANTES de entrar al salón)

```bash
# 1. Conectar kubectl al cluster
gcloud container clusters get-credentials microservices-cluster \
  --region us-central1 --project project-e17fa96d-a2f8-4371-ad2

# 2. Verificar que todo está Running
kubectl get pods -n microservices-demo
```

Todos los pods deben mostrar `Running`. Worker debe mostrar `2/2 Running`.

**Pestañas abiertas antes de empezar (en este orden):**

| # | Qué | URL |
|---|---|---|
| 1 | App vote | `http://34.132.209.134:8080` |
| 2 | App result | `http://34.63.41.74` |
| 3 | GCP — GKE Workloads | `https://console.cloud.google.com/kubernetes/workload/overview?project=project-e17fa96d-a2f8-4371-ad2` |
| 4 | GCP — Artifact Registry | `https://console.cloud.google.com/artifacts/docker/project-e17fa96d-a2f8-4371-ad2/us-central1/microservices-demo` |
| 5 | GCP — GKE Services | `https://console.cloud.google.com/kubernetes/discovery?project=project-e17fa96d-a2f8-4371-ad2` |
| 6 | GitHub Actions | `https://github.com/Alexis1661/microservices-demo/actions` |
| 7 | Código Cache-Aside | `https://github.com/Alexis1661/microservices-demo/blob/main/result/server.js` |
| 8 | Código Sidecar deployment | `https://github.com/Alexis1661/microservices-demo/blob/main/worker/chart/templates/deployment.yaml` |
| 9 | Código Sidecar worker | `https://github.com/Alexis1661/microservices-demo/blob/main/worker/main.go` |
| 10 | Terminal | Con kubectl listo |

---

## DEMO 1: La app funcionando (45 seg)

**Pantalla:** Pestañas 1 y 2 en split screen (o alternar rápido)

1. Mostrar `http://34.132.209.134:8080` — formulario de votación Tacos vs Burritos
2. Mostrar `http://34.63.41.74` — pantalla de resultados en tiempo real
3. Votar por "Tacos" → señalar cómo el contador sube en result **instantáneamente**

> *"Esta es la app completa desplegada en producción en GKE. vote está en Java, worker en Go, result en Node.js. Todo corriendo en Kubernetes en Google Cloud."*

---

## DEMO 2: Infraestructura en GCP Console (1.5 min)

### 2a — GKE Workloads (Pestaña 3)

**URL:** `https://console.cloud.google.com/kubernetes/workload/overview?project=project-e17fa96d-a2f8-4371-ad2`

Mostrar la lista de Deployments corriendo:
- `vote`, `worker`, `result`, `kafka`, `postgresql`, `redis`
- Hacer clic en **worker** → mostrar que tiene **2 containers**: `worker` + `health-sidecar`

> *"Aquí vemos todos los servicios desplegados en el cluster GKE Autopilot. Noten que worker tiene 2 containers — eso es el Sidecar Pattern que implementamos."*

### 2b — GKE Services & Ingress (Pestaña 5)

**URL:** `https://console.cloud.google.com/kubernetes/discovery?project=project-e17fa96d-a2f8-4371-ad2`

Mostrar los servicios con sus IPs externas:
- `vote` — LoadBalancer — `34.132.209.134:8080`
- `result` — LoadBalancer — `34.63.41.74:80`
- Los demás son ClusterIP (solo accesibles internamente)

> *"vote y result tienen IPs públicas porque los exponemos como LoadBalancer. El resto — Kafka, PostgreSQL, Redis — son internos al cluster por seguridad."*

### 2c — Artifact Registry (Pestaña 4)

**URL:** `https://console.cloud.google.com/artifacts/docker/project-e17fa96d-a2f8-4371-ad2/us-central1/microservices-demo`

Mostrar las imágenes Docker:
- `vote`, `worker`, `result` cada una con múltiples tags (uno por commit SHA + `latest`)

> *"Cada vez que el CI corre, sube una nueva imagen aquí con el SHA del commit como tag. El CD siempre despliega `:latest`. Esto nos da trazabilidad completa: si algo falla en producción, sabemos exactamente qué commit causó el problema."*

---

## DEMO 3: Cache-Aside Pattern — código + funcionamiento (2 min)

### 3a — Mostrar el código (Pestaña 7)

**URL:** `https://github.com/Alexis1661/microservices-demo/blob/main/result/server.js`

Señalar estas secciones en el código:

**Sección 1 — Conexión a Redis (líneas ~17-30):**
```javascript
var redis = new Redis(redisUrl, { retryStrategy: ... });
```
> *"Aquí conectamos al Redis que desplegamos en el cluster. La URL se construye con variables de entorno que Kubernetes inyecta automáticamente."*

**Sección 2 — La lógica Cache-Aside (función `getVotes`, líneas ~55-90):**
```javascript
const cached = await redis.get(CACHE_KEY);
if (cached) {
    // CACHE HIT
    io.sockets.emit('scores', cached);
} else {
    // CACHE MISS → query PostgreSQL → guardar en Redis
    await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, json);
}
```
> *"Este es el corazón del patrón. Primero pregunta a Redis. Si tiene el dato — HIT — lo sirve sin tocar la base de datos. Si no — MISS — va a PostgreSQL, guarda el resultado en Redis con un TTL de 5 segundos, y responde."*

### 3b — Mostrar el patrón en acción (Terminal)

```bash
kubectl logs -n microservices-demo deploy/result -f
```

Señalar en los logs mientras corren:
```
[cache] MISS — querying PostgreSQL    ← TTL expiró, va a la DB
[cache] Stored in Redis (TTL=5s)      ← guarda en caché
[cache] HIT — serving scores from Redis  ← 4 veces seguidas
[cache] HIT — serving scores from Redis
[cache] HIT — serving scores from Redis
[cache] HIT — serving scores from Redis
[cache] MISS — querying PostgreSQL    ← nuevo ciclo
```

Votar en la app (Pestaña 1) mientras se miran los logs:
> *"Ahora voten... vean cómo en el próximo MISS trae el dato actualizado. Sin Cache-Aside esto sería una query por segundo por cada usuario conectado. Con este patrón, son máximo 12 queries por minuto sin importar cuántos usuarios haya."*

---

## DEMO 4: Sidecar Pattern — código + funcionamiento (2 min)

### 4a — Mostrar el código del worker (Pestaña 9)

**URL:** `https://github.com/Alexis1661/microservices-demo/blob/main/worker/main.go`

Señalar estas secciones:

**Sección 1 — Struct de estado (líneas ~17-24):**
```go
type WorkerStatus struct {
    Status            string `json:"status"`
    MessagesProcessed int    `json:"messagesProcessed"`
    LastVote          string `json:"lastVote"`
    LastProcessedAt   string `json:"lastProcessedAt"`
}
```
> *"Definimos una estructura que representa el estado del worker. Esta se serializa a JSON y se escribe en un archivo compartido."*

**Sección 2 — Función writeStatus (después de main):**
```go
func writeStatus(count int, lastVote string, status string) {
    data, _ := json.Marshal(s)
    os.WriteFile("/health-data/status.json", data, 0644)
}
```
> *"Cada vez que procesa un mensaje, el worker actualiza este archivo en `/health-data/`. Es un volumen compartido entre los dos containers del pod."*

**Sección 3 — Llamada en el consumer:**
```go
case msg := <-consumer.Messages():
    // ... procesar mensaje ...
    writeStatus(*messageCountStart, string(msg.Value), "healthy")
```

### 4b — Mostrar el deployment YAML con el sidecar (Pestaña 8)

**URL:** `https://github.com/Alexis1661/microservices-demo/blob/main/worker/chart/templates/deployment.yaml`

Señalar:

**El volumen compartido:**
```yaml
volumes:
  - name: health-data
    emptyDir: {}
```
> *"Este volumen `emptyDir` existe mientras el pod vive. Ambos containers lo montan."*

**Los dos containers:**
```yaml
containers:
  - name: worker          # container principal — lógica de negocio
    volumeMounts:
      - name: health-data
        mountPath: /health-data

  - name: health-sidecar  # container secundario — observabilidad
    image: python:3.11-alpine
    ports:
      - containerPort: 8080
    volumeMounts:
      - name: health-data
        mountPath: /health-data
```
> *"Dos containers, un volumen compartido. El worker escribe, el sidecar lee y expone. Separación de responsabilidades — si quiero cambiar cómo se reporta el health, no toco el código Go."*

### 4c — Demostrar en vivo (Terminal)

```bash
# Mostrar los 2 containers del pod
kubectl get pods -n microservices-demo -l app=worker
```
```
NAME                     READY   STATUS    RESTARTS
worker-xxx               2/2     Running   0
```
> *"2/2 — dos containers corriendo en el mismo pod."*

```bash
# Consultar el sidecar
kubectl exec -n microservices-demo deploy/worker -c health-sidecar \
  -- wget -qO- localhost:8080/health
```
```json
{"status":"healthy","messagesProcessed":12,"lastVote":"a","lastProcessedAt":"2026-04-12T00:30:00Z"}
```

Votar en la app y repetir el comando:
> *"Voten ahora... y volvemos a consultar el sidecar."*

```bash
kubectl exec -n microservices-demo deploy/worker -c health-sidecar \
  -- wget -qO- localhost:8080/health
```
> *"messagesProcessed subió. El sidecar refleja el estado real del worker en tiempo real, sin que el worker tenga un servidor HTTP propio."*

---

## DEMO 5: Pipeline en vivo — código → producción (2 min)

> La parte más impactante. Muestra que todo el sistema está integrado.

### Paso 1 — Hacer el cambio (20 seg)

Editar en el IDE o con cualquier editor:

**Archivo:** `vote/src/main/java/com/okteto/vote/controller/VoteController.java`

Buscar (aproximadamente línea 85-87 dentro de la clase `Vote`):
```java
private String optionA = "Burritos";
private String optionB = "Tacos";
```
Cambiar a:
```java
private String optionA = "Pizza";
private String optionB = "Hamburguesa";
```

### Paso 2 — Push a develop (20 seg)

```bash
git checkout develop
git add vote/src/main/java/com/okteto/vote/controller/VoteController.java
git commit -m "demo: cambiar opciones a Pizza vs Hamburguesa"
git push origin develop
```

### Paso 3 — CI corre automáticamente (Pestaña 6, 40 seg)

- Ir a `https://github.com/Alexis1661/microservices-demo/actions`
- Mostrar **CI - Vote Service** apareciendo en la lista con el spinner girando
- Hacer clic → expandir los steps:
  - `Build, Test & Push Vote` → `Compilar con Maven` → `Correr tests` → `Push imagen a Artifact Registry`

> *"Sin hacer nada más, el pipeline detectó el push y arrancó solo. Está compilando en Java, corriendo los tests unitarios, y subiendo la nueva imagen Docker a Artifact Registry."*

### Paso 4 — Merge a main → CD arranca (30 seg)

```bash
git checkout main
git merge develop
git push origin main
```

- Volver a GitHub Actions → mostrar **CD - Deploy to GKE** arrancando
- Expandir: `Autenticar en GCP` → `Configurar kubectl para GKE` → `Desplegar vote`

> *"El merge a main disparó el despliegue automático. Helm está actualizando el Deployment de vote en el cluster GKE con rolling update — sin downtime."*

### Paso 5 — Mostrar en Artifact Registry (Pestaña 4, 20 seg)

- Ir a Artifact Registry → `vote`
- Mostrar la imagen nueva con el SHA del commit + tag `latest`

> *"La nueva imagen ya está en Artifact Registry con el SHA exacto del commit que acabamos de hacer."*

### Paso 6 — Resultado en producción (10 seg)

- Abrir `http://34.132.209.134:8080`
- Mostrar que ahora dice **Pizza vs Hamburguesa**

> *"De un cambio en el código a estar en producción en menos de 4 minutos. Eso es una pipeline CI/CD bien configurada."*

---

## Plan B (si algo falla)

| Problema | Solución |
|---|---|
| La app no carga | Verificar IP: `kubectl get svc -n microservices-demo` |
| CI no arrancó | Actions → CI - Vote Service → **Run workflow** (botón manual) |
| CD no arrancó | Actions → CD - Deploy to GKE → **Run workflow** |
| Logs de result no muestran cache | `kubectl rollout restart deploy/result -n microservices-demo` |
| Sidecar no responde | `kubectl rollout restart deploy/worker -n microservices-demo` |
| GCP Console tarda en cargar | Tener la terminal como respaldo con `kubectl` |

---

## Cheat sheet — todos los comandos en un lugar

```bash
# Ver estado general
kubectl get pods -n microservices-demo
kubectl get svc -n microservices-demo

# Cache-Aside: logs en vivo
kubectl logs -n microservices-demo deploy/result -f

# Sidecar: health check
kubectl exec -n microservices-demo deploy/worker -c health-sidecar \
  -- wget -qO- localhost:8080/health

# Sidecar: ver los 2 containers
kubectl describe pod -n microservices-demo -l app=worker | grep -A5 "Containers:"

# Pipeline demo: cambiar y pushear
git checkout develop
# ... editar archivo ...
git add -A && git commit -m "demo: cambio en vivo" && git push origin develop
git checkout main && git merge develop && git push origin main

# Redesplegar todo si algo falla
kubectl rollout restart deployment/vote deployment/worker deployment/result \
  -n microservices-demo
```
