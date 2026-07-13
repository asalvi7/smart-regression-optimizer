# Docker Deployment

> Covers Approach 1 (component-mapping pipeline) only. Target: a single corporate VM, accessed via Remote Desktop, running Docker Desktop/Engine directly (no Kubernetes/ECS orchestration).

## What's included

- `backend/Dockerfile` — Python 3.11-slim image running the FastAPI app under `uvicorn`, as a non-root user, with a built-in healthcheck against `/health`.
- `frontend/Dockerfile` — multi-stage build: Node 20 builds the Vite production bundle, then an `nginx:1.27-alpine` image serves the static files and reverse-proxies `/api/*` to the backend container.
- `frontend/nginx.conf` — the nginx config doing that proxying (backend resolved via Docker's internal DNS as hostname `backend`).
- `docker-compose.yml` (repo root) — wires both containers together on one Docker network, backend on `:8000`, frontend on `:80`.
- `.dockerignore` in both `backend/` and `frontend/` — excludes `venv/`, `node_modules/`, `.env`, and (defensively) any coverage/JaCoCo trial files, so a build never accidentally bakes in Approach 2 code even if it's sitting uncommitted in a local working copy.

## Important: build from a clean clone

Build these images from a fresh `git clone` of `stash main`, not from a working directory that also has the Approach 2 (coverage/JaCoCo) trial code checked out locally. The committed `main.py`/`config.py`/`requirements.txt` on `stash main` reference nothing from that trial; a dirty local working copy might have uncommitted edits that do (e.g. an `import` for the coverage router), which would build fine but fail at container startup since those files aren't part of what's tracked.

```bash
git clone https://stash.mediaocean.com/scm/pta/smart-execution.git
cd smart-execution
```

## First-time setup on the VM

1. Install Docker Desktop (or Docker Engine + Compose plugin) on the VM.
2. Clone the repo (above).
3. Create `backend/.env` from `backend/.env.example` and fill in real Stash/Jira credentials — same variables as local dev (see `02-setup-guide.md`). This file is required by `docker-compose.yml`'s `env_file:` directive; compose will error out immediately if it's missing.
4. Build and start both containers:

```bash
docker compose up -d --build
```

5. Verify:

```bash
curl http://localhost:8000/health      # backend directly
curl http://localhost/                 # frontend, proxied through nginx
```

6. Open `http://<VM-hostname-or-IP>/` in a browser from another machine on the network (or locally on the VM) to reach the dashboard.

## Day-to-day operations

```bash
docker compose ps                 # check container status
docker compose logs -f backend    # tail backend logs (poller activity, Jira/Stash errors)
docker compose restart backend    # restart just the backend (e.g. after editing .env — env vars are read once at startup)
docker compose down               # stop and remove both containers
docker compose up -d --build      # rebuild after pulling new code
```

Both services are set to `restart: unless-stopped`, so they come back automatically if the VM reboots or Docker restarts — you don't need to manually start them after a reboot, only after an intentional `docker compose down`.

## Notes and open items

- **CORS / `FRONTEND_URL`**: the frontend calls `/api/*` as a same-origin relative path, and nginx proxies that server-side to the backend container — the browser never makes a cross-origin request in this setup, so CORS mostly doesn't come into play for normal use. `FRONTEND_URL` in `backend/.env` still governs `Access-Control-Allow-Origin`; set it to how the app is actually accessed (e.g. `http://<VM-hostname>`) if anything ever needs to call the backend directly from a different origin.
- **Ports**: `80` (frontend) and `8000` (backend) are both published to the host. If either is already in use on the VM, change the left-hand side of the `ports:` mapping in `docker-compose.yml` (e.g. `"8080:80"`).
- **No persistence**: consistent with the rest of Approach 1 (see the "storing results" discussion elsewhere in this project's history) — nothing in this Docker setup adds persistence. A `docker compose down` or container restart still loses the in-memory poller history (`event_store`); that's unchanged from running it outside Docker.
- **HTTPS**: not configured. This setup serves plain HTTP on the VM's internal network. If this ever needs to be reachable outside the corporate network/VPN, put a reverse proxy or load balancer with TLS in front of it — don't expose port 80 directly to the internet.
