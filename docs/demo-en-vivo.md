# Guía de Demo en Vivo

> Ensaya esto al menos dos veces antes de la presentación.
> Abre todas las pestañas con anticipación. Objetivo: 8 minutos fluidos.

---

## Preparación previa (hacer ANTES de entrar al salón)

```bash
# 1. Conectar kubectl
gcloud container clusters get-credentials microservices-cluster \
  --region us-central1 --project project-e17fa96d-a2f8-4371-ad2

# 2. Verificar que todo está corriendo
kubectl get pods -n microservices-demo
```

Todos los pods deben mostrar `Running`. Worker debe mostrar `2/2`.

**Pestañas abiertas antes de empezar:**
1. App de votar: `http://34.132.209.134:8080`
2. App de resultados: `http://34.63.41.74`
3. GitHub Actions: `https://github.com/Alexis1661/microservices-demo/actions`
4. Terminal lista con kubectl apuntando al cluster

---

## DEMO 1: Mostrar la app funcionando (1 min)

**Pantalla:** Pestaña vote + pestaña result en split screen

1. Abrir `http://34.132.209.134:8080` → mostrar el formulario de votación
2. Abrir `http://34.63.41.74` → mostrar los resultados en tiempo real
3. Votar por "Tacos" → mostrar cómo el contador sube en result **en tiempo real**
4. Votar por "Burritos" → mismo efecto

**Qué decir:** *"Este es el flujo completo: vote recibe el click, lo publica en Kafka, worker lo consume y persiste en PostgreSQL, result lo lee y actualiza en tiempo real."*

---

## DEMO 2: Cache-Aside Pattern (1.5 min)

**Pantalla:** Terminal con logs de result

```bash
kubectl logs -n microservices-demo deploy/result -f
```

**Qué se ve:**
```
[cache] MISS — querying PostgreSQL
[cache] Stored in Redis (TTL=5s)
[cache] HIT — serving scores from Redis
[cache] HIT — serving scores from Redis
[cache] HIT — serving scores from Redis
[cache] HIT — serving scores from Redis
[cache] MISS — querying PostgreSQL
```

**Guión:**
1. Mostrar los logs corriendo en vivo
2. Señalar un MISS: *"Aquí el TTL de 5 segundos expiró — va a PostgreSQL"*
3. Señalar los 4 HITs seguidos: *"Estos 4 requests sirven el resultado desde Redis sin tocar la base de datos"*
4. Votar en la app (otra pestaña) y volver a los logs: *"Después de votar, en el próximo MISS trae el dato nuevo de la DB y lo vuelve a cachear"*

**Por qué es relevante:** *"Sin este patrón, result haría una query a PostgreSQL cada segundo por cada usuario conectado. Con Cache-Aside, son máximo 12 queries por minuto sin importar cuántos usuarios haya."*

---

## DEMO 3: Sidecar Pattern (1.5 min)

**Pantalla:** Terminal

```bash
# Paso 1: mostrar que el pod tiene 2 containers
kubectl get pods -n microservices-demo -l app=worker
```

Output esperado:
```
NAME                     READY   STATUS    RESTARTS   AGE
worker-7c9c66fc89-m84jv  2/2     Running   0          30m
```

**Señalar el `2/2`:** *"Este pod corre dos containers: el worker Go y el sidecar Python. Comparten un volumen."*

```bash
# Paso 2: consultar el endpoint del sidecar
kubectl exec -n microservices-demo deploy/worker -c health-sidecar \
  -- wget -qO- localhost:8080/health
```

Output esperado:
```json
{"status":"healthy","messagesProcessed":12,"lastVote":"a","lastProcessedAt":"2026-04-12T00:30:00Z"}
```

```bash
# Paso 3: votar en la app y repetir el comando — ver messagesProcessed subir
kubectl exec -n microservices-demo deploy/worker -c health-sidecar \
  -- wget -qO- localhost:8080/health
```

**Guión:** *"El worker principal Go no tiene servidor HTTP — solo procesa mensajes. El sidecar provee observabilidad sin modificar el código de negocio. Si quiero mejorar el health check o agregar métricas Prometheus, solo actualizo el sidecar."*

---

## DEMO 4: Pipeline en vivo — cambio de código → despliegue automático (3 min)

> Esta es la parte más importante. Muestra el ciclo completo CI/CD.

### Paso 1 — Hacer el cambio de código (30 seg)

Abre `vote/src/main/java/com/okteto/vote/controller/VoteController.java`

Cambia las opciones de votación (línea ~30 en la clase `Vote`):
```java
// ANTES:
private String optionA = "Burritos";
private String optionB = "Tacos";

// DESPUÉS (cambia durante la demo):
private String optionA = "Pizza";
private String optionB = "Hamburguesa";
```

### Paso 2 — Commit y push a develop (30 seg)

```bash
cd microservices-demo
git checkout develop
git add vote/src/main/java/com/okteto/vote/controller/VoteController.java
git commit -m "demo: cambiar opciones de votación a Pizza vs Hamburguesa"
git push origin develop
```

### Paso 3 — Mostrar CI corriendo (45 seg)

- Ir a `https://github.com/Alexis1661/microservices-demo/actions`
- Mostrar el pipeline **CI - Vote Service** arrancando automáticamente
- Expandir los steps: Maven build → Maven test → Docker push
- **Qué decir:** *"El pipeline arrancó solo con el push. Está compilando, testeando y subiendo la imagen a Artifact Registry en GCP."*

### Paso 4 — Merge a main → CD arranca (45 seg)

```bash
git checkout main
git merge develop
git push origin main
```

- Volver a GitHub Actions: mostrar **CD - Deploy to GKE** arrancando
- Expandir steps: get-gke-credentials → helm upgrade vote
- **Qué decir:** *"El merge a main disparó el despliegue. Helm está actualizando el servicio vote en el cluster GKE sin downtime."*

### Paso 5 — Mostrar el cambio en producción (30 seg)

- Abrir `http://34.132.209.134:8080`
- Mostrar que ahora dice **Pizza vs Hamburguesa**
- **Qué decir:** *"En menos de 4 minutos, un cambio de código está en producción. Esto es lo que permite una pipeline CI/CD bien configurada."*

---

## Plan B (si algo falla)

| Problema | Solución rápida |
|---|---|
| La app no abre | `kubectl get services -n microservices-demo` — usar la IP correcta |
| El CI no arrancó | Ir a Actions → CI - Vote Service → Run workflow manualmente |
| El pod está en error | `kubectl describe pod -n microservices-demo <nombre>` para diagnóstico |
| Redis no conecta | `kubectl rollout restart deployment/result -n microservices-demo` |
| Worker sidecar no responde | `kubectl rollout restart deployment/worker -n microservices-demo` |

---

## Comandos de respaldo para la demo (tenerlos copiados)

```bash
# Estado general
kubectl get pods -n microservices-demo

# Cache-Aside logs
kubectl logs -n microservices-demo deploy/result -f

# Sidecar health
kubectl exec -n microservices-demo deploy/worker -c health-sidecar -- wget -qO- localhost:8080/health

# Si necesitas redesplegar todo manualmente
kubectl rollout restart deployment/vote deployment/worker deployment/result -n microservices-demo
```
