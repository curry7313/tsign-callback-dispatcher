# TSign Callback Dispatcher

[中文](./README.md) | English

Receives encrypted callback notifications from [Tencent E-Sign](https://qian.tencent.com/) (腾讯电子签), decrypts them, and dispatches to multiple downstream services based on configurable rules (event types, tag filters, etc.), with optional re-encryption for each target.

## Features

- 🔐 **Receive & Decrypt**: Accepts [Tencent E-Sign](https://qian.tencent.com/) encrypted callbacks with automatic signature verification and decryption
- 🔀 **Rule-Based Dispatch**: Route callbacks to multiple downstream services by event type (`msgTypes`), tags, and more
- 🔒 **Re-Encryption**: Configure per-downstream encryption keys and signing tokens for end-to-end encrypted forwarding
- 🏷️ **Tag System**: Built-in FlowType / UserData tags, plus custom tags matching any JSON field path
- 📊 **Admin Panel**: React-based web UI for callback management, tag management, and system settings
- 🔄 **Hot Reload**: All configurations can be modified at runtime without service restart
- 📝 **Version History**: Configuration changes are automatically versioned with one-click rollback
- 🔑 **JWT Authentication**: All admin APIs require JWT authentication with login rate limiting
- 📈 **Observability**: Winston structured logging, audit trail, and health check endpoints
- 🐳 **Multi-Deployment**: Docker Compose / Kubernetes / Local development

## Architecture

```
Tencent E-Sign
    │
    ▼ (AES-256-CBC Encrypted Callback)
┌──────────────────────────────┐
│   Nginx (Frontend :8080)     │  ← Static files + Reverse proxy
│   ┌────────────────────────┐ │
│   │ Dispatcher Backend     │ │  ← Decrypt → Rule matching → Re-encrypt
│   │ (Express :3001)        │ │
│   └────────┬───────────────┘ │
└────────────┼─────────────────┘
             │
             ├──→ Downstream A (re-encrypted forwarding)
             ├──→ Downstream B (event type filtering)
             └──→ Downstream C (tag-based dispatch) ...
```

## Project Structure

```
├── backend/             # Backend service (Express + TypeScript)
│   └── src/
│       ├── controllers/ # Route controllers (callback, config, auth, health)
│       ├── services/    # Business logic (dispatch, config, tag matching, auth)
│       ├── middleware/   # Middleware (JWT auth, logging, validation, rate limit)
│       ├── types/       # TypeScript type definitions
│       ├── utils/       # Utilities (encryption/decryption)
│       └── app.ts       # Entry point
│   └── tests/           # Tests (unit / e2e / integration)
├── frontend/            # Admin frontend (React + Vite + TDesign)
│   └── src/
│       ├── pages/       # Pages (callbacks, tags, settings, login)
│       ├── components/  # Shared components (layout, tag editor)
│       └── lib/         # API client
├── config/              # Runtime configuration (JSON file storage)
│   ├── app.json         # App config (port, keys, dispatch params)
│   ├── callbacks.json   # Callback dispatch rules
│   ├── tags.json        # Tag definitions
│   ├── users.json       # User data
│   ├── operation-logs.json # Operation logs
│   └── versions/        # Config version history
├── docker/              # Docker deployment
│   ├── Dockerfile.backend    # Backend multi-stage build
│   ├── Dockerfile.frontend   # Frontend multi-stage build (Nginx)
│   ├── docker-compose.yml    # Production Compose
│   ├── nginx.conf            # Nginx config template (dynamic resolver)
│   ├── nginx.production.conf # Production Nginx (internal network only)
│   ├── docker-entrypoint.sh  # Entrypoint script (DNS injection)
│   └── test/                 # Docker test environment
├── k8s/                 # Kubernetes deployment manifests
├── Makefile             # Build / push / deploy shortcuts
├── dev.sh               # Local development management script
└── package.json
```

## Quick Start

> Deploy and receive your first callback in 5 minutes.

### Option 1: Docker Compose One-Click Deploy (Recommended ⭐)

The simplest deployment method, suitable for most scenarios. **Prerequisites**: Docker >= 20, Docker Compose V2.

```bash
# 1. Clone the project
git clone <your-repo-url> && cd tsign-callback-dispatcher

# 2. Configure E-Sign encryption key
#    Edit config/app.json, replace tsign.encryptKey with the key from Tencent E-Sign
#    Optionally fill in tsign.token for signature verification

# 3. Configure security credentials (⚠️ MUST change in production)
cat > docker/.env << 'EOF'
JWT_SECRET=your-strong-random-jwt-secret-at-least-32-chars
ADMIN_DEFAULT_PASSWORD=your-strong-admin-password
EOF

# 4. Build and start
cd docker
docker compose up -d --build

# 5. Check service status
docker compose ps
```

Once started:

| Service | URL | Notes |
|---------|-----|-------|
| Admin Panel | http://localhost | Login with `admin` and the password you set above |
| Callback Endpoint | http://your-domain/api/callback | 📋 Configure this URL in [Tencent E-Sign](https://qian.tencent.com/) console |
| Health Check | http://localhost/api/health | Verify service is running |

> **🔒 Security Note**: Production Nginx restricts admin APIs and UI to internal networks. Only `/api/callback` and `/api/health` are publicly accessible.

**Common operations**:

```bash
cd docker

docker compose ps                  # Check service status
docker compose logs -f backend     # View backend logs
docker compose logs -f frontend    # View frontend/Nginx logs
docker compose restart backend     # Restart backend
docker compose down                # Stop all services
docker compose up -d --build       # Rebuild and start (after code changes)
```

Or use Makefile shortcuts (from project root):

```bash
make compose-up       # Start
make compose-down     # Stop
make build            # Build images only
make push TAG=v1.0.0  # Build and push to remote registry
make info             # Show build info
```

### Option 2: Kubernetes Deployment

For production environments requiring high availability, multi-replica, and auto-scaling. **Prerequisites**: kubectl configured with cluster access, Ingress Controller ready.

```bash
# 1. Create Secret (copy from template, ⚠️ do NOT commit to Git)
cp k8s/secret.yaml.example k8s/secret.yaml
# Edit k8s/secret.yaml with JWT_SECRET and ADMIN_DEFAULT_PASSWORD

# 2. Configure E-Sign keys
# Edit k8s/configmap.yaml with tsign.encryptKey and tsign.token

# 3. Configure domain
# Edit k8s/ingress.yaml, replace host with your actual domain

# 4. (Optional) If using a private registry, update the image field in Deployments
# Defaults to latest tag, ready to use out of the box

# 5. Deploy to cluster
kubectl apply -f k8s/

# 6. Verify deployment
kubectl get pods -l app=tsign-dispatcher
curl https://your-domain.com/api/health
```

> 📖 For detailed K8s guide (RBAC, TLS, multi-replica config sharing, etc.), see the [Kubernetes Deployment](#kubernetes-deployment) section below.

### Option 3: Local Development

For customization or debugging. **Prerequisites**: Node.js >= 18, npm >= 9.

```bash
# 1. Install all dependencies
npm run install:all

# 2. Configure E-Sign keys (edit config/app.json)

# 3. Start services
./dev.sh start          # Background mode, starts both frontend and backend
./dev.sh status         # Check status
./dev.sh logs           # View backend logs
```

| Service | URL |
|---------|-----|
| Frontend UI | http://localhost:3000 |
| Backend API | http://localhost:3001 |

<details>
<summary>More dev.sh commands</summary>

```bash
./dev.sh start [backend|frontend]   # Start (default: all)
./dev.sh stop  [backend|frontend]   # Stop
./dev.sh restart [backend|frontend] # Restart
./dev.sh status                     # Check running status
./dev.sh logs [backend|frontend]    # Tail logs
```

Equivalent npm scripts:

```bash
npm run dev              # Start all
npm run dev:stop         # Stop all
npm run dev:restart      # Restart all
npm run dev:status       # Check status
npm run dev:logs         # Backend logs
npm run dev:logs:frontend # Frontend logs
```

For foreground mode (real-time output):

```bash
# Terminal 1 - Backend
npm run dev:backend

# Terminal 2 - Frontend
npm run dev:frontend
```

> 💡 Dependencies are auto-installed on first start. PID files are stored in `.dev-pids/`, logs in `logs/dev/`.

</details>

### Post-Deployment Configuration

After the service is running, complete initial setup through the admin panel:

1. **Login to Admin Panel** — Visit the admin UI, login with `admin` and your configured password
2. **Verify E-Sign Keys** — Go to "Settings" page to confirm the encryption key and signing token are correct
3. **Add Downstream Callbacks** — On the "Callback Management" page, add downstream service URLs with event type filters, tag matching rules, etc.
4. **Configure [Tencent E-Sign](https://qian.tencent.com/)** — Enter `https://your-domain/api/callback` as the callback URL in the [Tencent E-Sign](https://qian.tencent.com/) console
5. **Verify Callbacks** — Trigger a test callback from the [Tencent E-Sign](https://qian.tencent.com/) console to confirm downstream services receive it

### Quick Verification

You can also verify via command line:

```bash
# Health check
curl http://localhost/api/health

# Send a test callback (replace with real encrypted data)
curl -X POST http://localhost/api/callback \
  -H "Content-Type: application/json" \
  -d '{"encrypt": "<encrypted_payload>", "timestamp": "1234567890", "nonce": "abc", "msg_signature": "xxx"}'
```

Or use the Docker test environment for end-to-end verification (with mock downstream receivers):

```bash
npm run test:docker:up     # Start test env (Dispatcher + 2 Receivers)
npm run test:docker:send   # Send test message
npm run test:docker:check  # Verify downstream received it
npm run test:docker:down   # Stop test env
```

## Configuration

### Config Storage Modes

The service supports two configuration storage backends, controlled by the `CONFIG_STORE` environment variable:

| Mode | Description | Use Case |
|------|-------------|----------|
| `file` (default) | Config stored in JSON files under `config/` | Docker Compose, local development |
| `k8s` | Config stored in Kubernetes ConfigMap via K8s API | Kubernetes deployment (shared across replicas) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment (`production` / `development` / `test`) |
| `CONFIG_STORE` | `file` | Config storage mode (`file` / `k8s`) |
| `CONFIG_DIR` | `/app/config` | Config directory path (file mode) |
| `K8S_CONFIGMAP_NAME` | `tsign-dispatcher-config` | ConfigMap name (k8s mode) |
| `K8S_NAMESPACE` | *(auto-detected)* | Namespace (k8s mode) |
| `JWT_SECRET` | *(built-in default, insecure)* | **⚠️ Must change in production** JWT signing secret |
| `JWT_EXPIRES_IN` | `24h` | JWT token expiration |
| `ADMIN_DEFAULT_PASSWORD` | `admin123` | **⚠️ Must change in production** Default admin password |
| `CORS_ORIGINS` | *(empty, CORS disabled)* | Allowed CORS origins (comma-separated) |
| `LOG_LEVEL` | `info` | Log level (`debug` / `info` / `warn` / `error`) |

### app.json

```json
{
  "server": { "port": 3001, "host": "0.0.0.0" },
  "tsign": {
    "encryptKey": "Message encryption key from Tencent E-Sign (32 bytes)",
    "token": "Signature verification token (optional)"
  },
  "dispatch": {
    "defaultTimeout": 10000,
    "defaultRetryCount": 3,
    "retryDelay": 1000
  },
  "log": { "level": "info", "maxFiles": 30 }
}
```

### callbacks.json

Defines downstream dispatch rules. Each rule includes:
- **Target URL** (`url`): Downstream receiver address
- **Timeout & Retry** (`timeout` / `retryCount`)
- **Event Type Filter** (`msgTypes`): Empty array = accept all events
- **Tag Filter** (`tags`): Match callback message fields by key/value
- **Re-Encryption** (`encryptKey` / `signToken`): Re-encrypt messages for downstream, keys auto-generated
- **Unknown Event Policy** (`unknownMsgTypePolicy`): `dispatch` (forward) / `drop` (discard) / `log` (log only)

### tags.json

Tag definitions with two built-in tags:
- **FlowType** (Contract Type) — Matches `MsgData.FlowType` field
- **UserData** (Custom Data) — Matches `MsgData.UserData` field

Custom tags can be added via the admin panel, targeting any JSON field path (e.g., `MsgData.xxx`).

## Docker Deployment

### Architecture Overview

```
External Traffic
  │
  ▼ :80
┌─────────────────────────────────────────┐
│  Frontend Container (Nginx :8080)       │
│  ├─ Static files → /usr/share/nginx/html│
│  ├─ /api/callback  → proxy_pass backend │  ← Public (E-Sign callback endpoint)
│  ├─ /api/health    → proxy_pass backend │  ← Public
│  ├─ /api/*         → proxy_pass backend │  ← Internal only (Admin API)
│  └─ /*             → SPA fallback       │  ← Internal only (Admin UI)
└─────────────┬───────────────────────────┘
              │ (Docker internal network)
              ▼ :3001
┌─────────────────────────────────────────┐
│  Backend Container (Express :3001)      │
│  ├─ JWT-protected admin APIs            │
│  ├─ Hot-reload config (file mode)       │
│  └─ Callback dispatch + re-encryption   │
└─────────────────────────────────────────┘
```

### Production Deployment

**1. Configure Environment Variables**

Create `docker/.env` (or export to shell):

```bash
# ⚠️ Must be changed in production!
JWT_SECRET=your-strong-random-jwt-secret-at-least-32-chars
ADMIN_DEFAULT_PASSWORD=your-strong-admin-password

# Optional
JWT_EXPIRES_IN=24h
CORS_ORIGINS=
LOG_LEVEL=info
```

**2. Start Services**

```bash
cd docker
docker compose up -d --build
```

**3. Using Makefile Shortcuts**

```bash
make compose-up       # Start
make compose-down     # Stop
make build            # Build images only
make push TAG=v1.0.0  # Build and push to registry
make info             # Show build info
```

**4. Access Services**

| Service | URL | Notes |
|---------|-----|-------|
| Admin UI | http://localhost:80 | Nginx serves static files + reverse proxy |
| Backend API | Not directly exposed | Access only through Nginx reverse proxy |
| Callback Endpoint | http://your-domain/api/callback | Configure this in [Tencent E-Sign](https://qian.tencent.com/) |

> **Security Note**: Production Nginx config (`nginx.production.conf`) restricts admin APIs and UI to internal networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). Only the callback endpoint and health check are publicly accessible.

### Docker Test Environment

`docker/test/` provides a complete multi-service test environment (1 Dispatcher + 2 Receivers + Frontend):

```bash
# Start test environment
npm run test:docker:up

# Send test callback
npm run test:docker:send -- message.json

# Check downstream received callbacks
npm run test:docker:check

# View service status / logs
npm run test:docker:status
npm run test:docker:logs

# Stop / clean
npm run test:docker:down
npm run test:docker:clean
```

See `docker/test/test-env.sh --help` for details.

## Kubernetes Deployment

### K8s Resource Overview

```
k8s/
├── configmap.yaml          # App config (app.json, callbacks.json, tags.json)
├── secret.yaml.example     # Secret template (JWT_SECRET, ADMIN_DEFAULT_PASSWORD)
├── backend-deployment.yaml # Backend Deployment (2 replicas, health checks, resource limits)
├── frontend-deployment.yaml# Frontend Deployment (2 replicas, Nginx + reverse proxy)
├── service.yaml            # ClusterIP Service (backend:3001, frontend:80)
└── ingress.yaml            # Ingress rules (domain routing, rate limiting, security headers)
```

### Deployment Steps

#### Step 1: Choose Namespace

```bash
# Use default namespace (k8s/ manifests)
NAMESPACE=default

# Or create a dedicated namespace
kubectl create namespace tsign-dispatcher
```

> **⚠️ Action Required**: If not using the `default` namespace, update the `namespace` field in all YAML files.

#### Step 2: Create Secret

```bash
# Copy from template
cp k8s/secret.yaml.example k8s/secret.yaml
```

Edit `k8s/secret.yaml`, replace placeholders:

```yaml
# ⚠️ Must modify! Replace with your actual values
stringData:
  JWT_SECRET: "<REPLACE_WITH_STRONG_SECRET>"           # ← Strong random string (>=32 chars)
  ADMIN_DEFAULT_PASSWORD: "<REPLACE_WITH_STRONG_PASSWORD>"  # ← Admin password
```

> **🔒 Security Tip**: `secret.yaml` contains sensitive data — do not commit to Git (`.gitignore` already excludes it). For production, consider Sealed Secrets or External Secrets Operator.

#### Step 3: Configure ConfigMap

Edit `k8s/configmap.yaml` with actual [Tencent E-Sign](https://qian.tencent.com/) keys:

```yaml
data:
  app.json: |
    {
      "tsign": {
        "encryptKey": "",  # ← ⚠️ E-Sign message encryption key
        "token": ""        # ← ⚠️ Signature verification token (if used)
      }
    }
```

#### Step 4: Configure Image Addresses (Optional)

K8s manifests default to the `latest` tag, ready to use out of the box. If using a private registry, edit `k8s/backend-deployment.yaml` and `k8s/frontend-deployment.yaml`:

```yaml
# backend-deployment.yaml
containers:
  - name: backend
    image: ccr.ccs.tencentyun.com/pulse-line-prod/tsign-dispatcher-backend:latest
    #       ↑ Update to your private registry address if needed
```

```yaml
# frontend-deployment.yaml
containers:
  - name: frontend
    image: ccr.ccs.tencentyun.com/pulse-line-prod/tsign-dispatcher-frontend:latest
    #       ↑ Update to your private registry address if needed
```

Push images using Makefile:

```bash
# Push to your registry
make push TAG=v1.0.0

# Or with custom registry
make push REGISTRY=your-registry.com NAMESPACE=your-project TAG=v1.0.0
```

#### Step 5: Configure Ingress

Edit `k8s/ingress.yaml`:

```yaml
spec:
  ingressClassName: nginx  # ← ⚠️ Confirm IngressClass name in your cluster
  rules:
    - host: tsign-dispatcher.your-domain.com  # ← ⚠️ Replace with your domain
```

**Enable HTTPS (recommended)** — uncomment the TLS section:

```yaml
spec:
  tls:
    - hosts:
        - tsign-dispatcher.your-domain.com  # ← Replace with actual domain
      secretName: tsign-dispatcher-tls       # ← TLS certificate Secret name
  # For cert-manager auto-issuance, uncomment:
  # annotations:
  #   cert-manager.io/cluster-issuer: letsencrypt-prod
```

**Restrict admin UI access** (optional) — uncomment whitelist:

```yaml
annotations:
  nginx.ingress.kubernetes.io/whitelist-source-range: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
```

#### Step 6: Configure Frontend-Backend Communication

The frontend uses `BACKEND_UPSTREAM` to locate the backend Service. Verify in `k8s/frontend-deployment.yaml`:

```yaml
env:
  - name: BACKEND_UPSTREAM
    value: "tsign-dispatcher-backend.default.svc.cluster.local:3001"
    #       ^^^^^^^^^^^^^^^^^^^^^^^^ ^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^
    #       Service name            Namespace  K8s internal DNS suffix
    #       ⚠️ Update namespace if changed
```

#### Step 7: Apply Manifests

```bash
# File mode deployment (standard)
kubectl apply -f k8s/

# Or using Makefile
make deploy
```

Verify deployment:

```bash
# Check Pod status
kubectl get pods -l app=tsign-dispatcher

# Check Services
kubectl get svc -l app=tsign-dispatcher

# Check Ingress
kubectl get ingress tsign-dispatcher-ingress

# View backend logs
kubectl logs -l app=tsign-dispatcher,component=backend -f

# Health check
curl https://tsign-dispatcher.your-domain.com/api/health
```

### K8s Resource Reference

#### Backend Resource Limits

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

#### Frontend Resource Limits

```yaml
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 200m
    memory: 256Mi
```

#### Health Check Configuration

| Component | Probe | Path | Initial Delay | Interval |
|-----------|-------|------|---------------|----------|
| Backend | liveness | `/api/health` | 15s | 30s |
| Backend | readiness | `/api/health` | 5s | 10s |
| Frontend | liveness | `/healthz` | 10s | 30s |
| Frontend | readiness | `/healthz` | 5s | 10s |

> Frontend `/healthz` is served directly by Nginx (returns `200 ok`), independent of the backend.

#### Security Context

Backend Pods run as non-root user (uid=1000), Frontend Nginx runs as nginx user (uid=101), both with privilege escalation disabled.

### Configuration Checklist

Summary of items that **must be reviewed and modified** before deployment:

| File | Item | Description |
|------|------|-------------|
| `secret.yaml` | `JWT_SECRET` | ⚠️ Replace with strong random string |
| `secret.yaml` | `ADMIN_DEFAULT_PASSWORD` | ⚠️ Replace with admin password |
| `configmap.yaml` | `tsign.encryptKey` | ⚠️ E-Sign encryption key |
| `configmap.yaml` | `tsign.token` | Signature token (if needed) |
| `backend-deployment.yaml` | `image` | Default `latest`, optionally update for private registry |
| `frontend-deployment.yaml` | `image` | Default `latest`, optionally update for private registry |
| `frontend-deployment.yaml` | `BACKEND_UPSTREAM` | Update if namespace changed |
| `ingress.yaml` | `host` | ⚠️ Replace with actual domain |
| `ingress.yaml` | `ingressClassName` | Confirm cluster IngressClass |
| `ingress.yaml` | `tls` | Recommended: enable HTTPS |
| All YAMLs | `namespace` | Update all if not using default |

## API Endpoints

### Public Endpoints (No Authentication Required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/callback` | Receive [Tencent E-Sign](https://qian.tencent.com/) encrypted callback |
| GET  | `/api/health` | Health check |
| POST | `/api/auth/login` | Admin login (rate limited: 10 attempts per 15 minutes) |

### Admin Endpoints (JWT Authentication Required)

Requests must include `Authorization: Bearer <token>` header.

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/system-status` | System runtime status (uptime, version, etc.) |
| GET  | `/api/auth/profile` | Get current user info |
| PUT  | `/api/auth/password` | Change password |
| GET  | `/api/received-callbacks` | View recently received callback records |
| DELETE | `/api/received-callbacks` | Clear callback records |
| GET  | `/api/callbacks` | List callback configurations |
| GET  | `/api/callbacks/:id` | Get single callback configuration |
| POST | `/api/callbacks` | Create callback configuration |
| PUT  | `/api/callbacks/:id` | Update callback configuration |
| DELETE | `/api/callbacks/:id` | Delete callback configuration |
| GET  | `/api/callbacks/generate-keys` | Generate encryption keys and signing tokens |
| GET  | `/api/tags` | List tags |
| GET  | `/api/tags/:id` | Get single tag |
| POST | `/api/tags` | Create tag |
| PUT  | `/api/tags/:id` | Update tag |
| DELETE | `/api/tags/:id` | Delete tag |
| GET  | `/api/tsign-config` | Get E-Sign configuration |
| PUT  | `/api/tsign-config` | Update E-Sign configuration |
| GET  | `/api/versions/:type` | Get config version history |
| POST | `/api/versions/:type/rollback` | Rollback config to a specific version |
| GET  | `/api/logs` | Get operation logs |

## Testing

### Unit & Integration Tests

Based on **Vitest** testing framework:

```bash
cd backend

# Run all tests
npm test

# Run unit tests
npx vitest run tests/unit/

# Run E2E tests (build backend first)
npm run build
npx vitest run tests/e2e/

# Run integration tests
npx vitest run tests/integration/
```

### Performance Testing

Performance testing with **K6** + **InfluxDB** + **Grafana**, located in `docker/test/`.

### Performance Test Architecture

```
K6 (local) ──POST──→ Dispatcher (Docker:5001) ──dispatch──→ Receiver-B/C (Docker:5002/5003)
    │
    └──metrics──→ InfluxDB (Docker:8086) ──query──→ Grafana (Docker:3030)
```

### File Structure

```
docker/test/
├── docker-compose.perf.yml          # Performance test compose (Dispatcher + InfluxDB + Grafana)
├── perf-test.sh                     # Management script
└── k6/
    ├── scripts/
    │   ├── load-test.js             # K6 plaintext mode load test
    │   └── encrypt-load-test.js     # K6 encrypted mode load test (pre-generated data)
    └── grafana/
        ├── dashboards/
        │   └── k6-dashboard.json    # Pre-configured Grafana dashboard
        └── provisioning/
            ├── datasources/influxdb.yml
            └── dashboards/dashboard.yml
```

### Prerequisites

- Docker & Docker Compose
- [K6](https://k6.io/) (`brew install k6` or `perf-test.sh` will prompt for installation)

### Usage

```bash
cd docker/test

# 1. Start performance test infrastructure (Dispatcher + InfluxDB + Grafana)
./perf-test.sh up

# 2. Open Grafana dashboard (http://localhost:3030)
./perf-test.sh dash

# 3. Run tests
./perf-test.sh run smoke             # Smoke test
./perf-test.sh run load              # Load test
./perf-test.sh run stress            # Stress test
./perf-test.sh run soak              # Soak test

# 4. Encrypted mode (generate data first, then test)
./perf-test.sh gen-data              # Generate encrypted message data
./perf-test.sh run-encrypted load    # Encrypted mode load test

# 5. View results / shut down
./perf-test.sh report                # View results summary
./perf-test.sh down                  # Stop all services
```

### Test Scenarios

| Scenario | VUs | Duration | Purpose |
|----------|-----|----------|---------|
| **smoke** | 1 | 30s | Verify basic functionality |
| **load** | 0→20→50 | 3.5min | Simulate normal peak traffic |
| **stress** | 0→200 | 5min | Maximum stress test |
| **soak** | 30 | 10min | Memory leak detection |

### Grafana Dashboard Metrics

- **Overview**: Avg/P95/P99 response time, error rate, RPS, active VUs
- **Real-Time Trends**: Response time distribution, VU changes, RPS throughput, data transfer rate
- **Detailed Metrics**: Request phase timing (connect/TLS/send/wait/receive), custom dispatch success rate

> Grafana default address: `http://localhost:3030`, no login required (anonymous access enabled), K6 Dashboard is pre-configured.

## Makefile Commands

```bash
make help             # Show all available commands
make build            # Build frontend and backend Docker images (native architecture)
make push TAG=v1.0.0  # Build and push images to remote registry
make deploy           # Apply k8s/ configs to Kubernetes
make compose-up       # Docker Compose start (production config)
make compose-down     # Docker Compose stop
make dev              # Start local development
make dev-stop         # Stop local development
make test             # Start Docker test environment
make test-send        # Send test callback
make test-check       # Check receiver received callbacks
make clean            # Clean build artifacts and dangling images
make info             # Show current build info (version, image address, etc.)
```

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Backend** | Express + TypeScript + Winston (logging) + Axios (HTTP forwarding) |
| **Security** | Helmet (security headers) + JWT auth + bcrypt (password hashing) + express-rate-limit |
| **Frontend** | React 18 + Vite + TDesign + Tailwind CSS + Recharts |
| **Testing** | Vitest (unit/E2E/integration) + K6 (load testing) + InfluxDB + Grafana |
| **Deployment** | Docker / Docker Compose / Kubernetes |
| **CI/CD** | Makefile + Docker Buildx (multi-architecture builds) |
| **Image Registry** | Tencent Cloud Container Registry (CCR) |

## License

Private - Internal use only.
