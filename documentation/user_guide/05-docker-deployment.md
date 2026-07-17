# Docker Deployment

## What's included

`docker-compose.yml` at the repo root runs the backend (FastAPI, port 8000) and frontend (served via nginx, port 80) as two containers.

## Running it

```bash
cp backend/.env.example backend/.env   # fill in real credentials
docker compose up -d --build
```

## Checking it worked

```bash
docker compose ps
curl http://localhost:8000/health
curl http://localhost/
```

## Day to day

```bash
docker compose logs -f backend
docker compose restart backend
docker compose down
```

For anything beyond standard start/stop/rebuild — networking, ports, TLS, VM setup — check with the project maintainer.
