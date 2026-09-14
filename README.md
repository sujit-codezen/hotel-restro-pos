# POS Restro Hotel

A multi-tenant SaaS POS + billing platform for restaurants and hotels (including a hotel with an in-house restaurant), with charge-to-room billing that settles as one invoice at checkout.

- **Backend**: Django + DRF + PostgreSQL + Redis + Celery + Channels (`backend/`)
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind (`frontend/`)

## Features

**Restaurant**
- POS ordering by table, with modifiers, holds, and merges
- Live kitchen display (KDS) over WebSocket — tickets update the moment an order's sent
- Menu management — items, categories, modifier groups, tax classes
- Percent/fixed discounts, applied per invoice at checkout

**Hotel**
- Rooms and room types, with double-booking prevention on overlapping dates
- Reservations — booking, check-in/out, editing a still-booked stay's room/dates, cancellation
- Pre-ordering food against a booked reservation before check-in
- Folio billing — room + restaurant + service charges on one running bill, advance/deposit payments mid-stay, charge-to-room ordering embedded on the folio, and settlement into a single invoice at checkout

**Billing & customers**
- Invoices with partial payments, refunds, and void; receipts
- Customer directory with purchase and stay history, loyalty points, credit balance

**Admin**
- Staff accounts, invited directly into the org (not the public self-signup path)
- Role-based permissions — refund/void, staff, settings, menu, discounts, and reports are each gated by a per-role flag; pages reflect a role's actual access instead of just erroring on click
- Reports — daily sales, best-selling items, payment methods, tax collected, staff performance, and a by-property breakdown for multi-store organizations
- Dashboard — today's sales/orders/items/pending-credit, each with a 7-day sparkline, plus a 7-day sales trend chart and quick links into the day-to-day screens

See [`plan.md`](plan.md) for the full architecture and phased roadmap.

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
