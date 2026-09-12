# POS Restro Hotel

A multi-tenant SaaS POS + billing platform for restaurants and hotels (including a hotel with an in-house restaurant), with charge-to-room billing that settles as one invoice at checkout. See [`plan.md`](plan.md) for the full architecture and roadmap.

- **Backend**: Django + DRF + PostgreSQL + Redis + Celery + Channels (`backend/`)
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind (`frontend/`)

## Local development

Requires Python 3.12+, Node 20+, Docker, and a local `redis-server` running on 6379 (not containerized in dev — see `docker-compose.yml`).

**Backend**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # adjust DB_PORT etc. if 5434 is taken locally
cd .. && docker compose up -d postgres
cd backend
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 8000   # channels/daphne serves both HTTP and WS
```

**Frontend**
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev   # http://localhost:3000
```

Run the tenant-isolation suite before shipping any change that touches a ViewSet:
```bash
cd backend && python manage.py test core
```

## Production

`docker-compose.prod.yml` builds and runs the full stack — nginx, backend (Daphne/ASGI, required for the KDS WebSocket), celery-worker, celery-beat, frontend (Next.js standalone), postgres, redis:

```bash
cp backend/.env.example backend/.env   # fill in real SECRET_KEY/DB_PASSWORD/ALLOWED_HOSTS
export DB_PASSWORD=...                  # must match backend/.env
export PUBLIC_API_BASE_URL=https://your-domain/api
export PUBLIC_WS_BASE_URL=wss://your-domain/ws
docker compose -f docker-compose.prod.yml up -d --build
```

`nginx/nginx.conf` is HTTP-only — it's a starting point for a VPS deploy. Point a real domain at it and add TLS (certbot) before going live; the `/ws/` location already carries the `Upgrade`/`Connection` headers Channels needs.

## Repo layout

```
backend/    Django project — see backend app table in plan.md section 2
frontend/   Next.js app — see route list in plan.md section 4
nginx/      Reverse proxy config for docker-compose.prod.yml
plan.md     Architecture, phased roadmap, and Phase 1 verification steps
```
