# Restaurant + Hotel POS/Billing SaaS — Full Plan

## Context

The goal is a POS + billing platform focused deliberately on **restaurants and hotels only** (not a universal retail/grocery/clothing ERP) — a hotel that also runs a restaurant, or a standalone restaurant, should be able to bill everything (dine-in orders, room service, laundry, misc charges) through one fast, simple screen and one invoice per transaction/stay. It is being built as a **multi-tenant SaaS** from day one: one codebase serves many hotel/restaurant businesses as paying customers, so tenant data isolation and a future subscription-billing path are architectural requirements now, even though subscription billing itself ships later.

This is a greenfield build — no existing codebase to extend. Stack and scope were confirmed with the user:
- **Backend:** Django + Django REST Framework + PostgreSQL + Redis + Celery
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + React Query
- **Infra:** Docker + Nginx + Gunicorn/Daphne on a VPS
- **Offline-capable PWA billing is explicitly deferred** to a later phase, but the data model (UUID invoice IDs + idempotency keys, server-assigned display numbers only at finalize) is designed so offline sync is additive later, not a rewrite.
- **Real-time KDS (Kitchen Display System) needs instant updates** → build with Django Channels + Redis (WebSockets) in Phase 1, not polling.
- **Invoice numbering:** best-effort sequential per store, assigned at finalize (not strict no-gap).
- **Hotel folios settle once at checkout** in Phase 1 — no mid-stay/deposit payments yet (data model allows adding this later without rework).

---

## 1. Domain / Data Model

### Tenancy root
```
Organization (id, name, slug, business_type[RESTAURANT|HOTEL|HOTEL_RESTAURANT],
              timezone, currency, is_active, created_at)
Store (id, organization FK, parent_store FK[self, null], store_type[RESTAURANT|HOTEL_PROPERTY],
       name, address, phone, is_active)
```
- "Hotel + Restaurant" = one `Store(store_type=HOTEL_PROPERTY)` plus one `Store(store_type=RESTAURANT, parent_store=<hotel store>)`, both rolling up to the same `Organization`.
- **Every** tenant-owned model carries `organization` as a direct FK (not just derived through `store`), so a single filter works everywhere: `.filter(organization=request.org)`.

### Identity & staff
```
User (custom AbstractUser, email login, organization FK[null for platform staff])
StoreStaff (user FK, store FK, role[OWNER|ADMIN|MANAGER|CASHIER|WAITER|KITCHEN|FRONT_DESK], is_active)
```
Phase 1 uses a fixed role enum with a small in-code permission matrix (DRF permission classes keyed by role). DB-driven custom roles/permissions are a Phase 2 upgrade — additive, not a rewrite.

### Catalog (restaurant menu — scoped, not a generic product engine)
```
MenuCategory (organization, store, name, sort_order)
MenuItem (organization, store, category FK, name, price, tax_class FK, kitchen_station, is_active)
ModifierGroup (organization, store, name, selection_type[SINGLE|MULTIPLE], min_select, max_select, is_required)
Modifier (modifier_group FK, name, price_delta)
MenuItemModifierGroup (menu_item FK, modifier_group FK, sort_order)   -- reusable groups (e.g. "Size") across items
```

### Tables
```
Table (organization, store, name, capacity, status[AVAILABLE|OCCUPIED|BILLING|RESERVED], pos_x, pos_y, shape)
```

### Orders & Kitchen
```
Order (organization, store, order_type[DINE_IN|TAKEAWAY|DELIVERY|ROOM_SERVICE],
       table FK[null], customer FK[null], guest_stay FK[null],
       status[OPEN|HELD|SENT_TO_KITCHEN|READY|SERVED|BILLED|CHARGED_TO_ROOM|CANCELLED],
       created_by StoreStaff FK, created_at)
OrderItem (order FK, menu_item FK, quantity, unit_price[snapshot], notes,
           status[NEW|COOKING|READY|SERVED], kitchen_station)
OrderItemModifier (order_item FK, modifier FK, price_delta[snapshot])
KitchenTicket (organization, store, order FK, kitchen_station, status[derived from items])
KitchenTicketItem (kitchen_ticket FK, order_item FK)
```
`KitchenTicket`s are generated when an order is sent to kitchen, grouped by `kitchen_station` (e.g. "Bar" vs "Kitchen" get separate tickets/screens). Ticket status is derived from its items via signal, not independently editable.

### Universal Billing (convergence point for restaurant + hotel)
```
TaxClass (organization, name, rate_percent, is_inclusive)
Discount (organization, name, type[PERCENT|FIXED], value)
Invoice (id UUID, organization, store, idempotency_key UUID unique,
         source_type[ORDER|FOLIO], order FK[null], folio FK[null],
         customer FK[null], status[DRAFT|UNPAID|PARTIALLY_PAID|PAID|VOID],
         subtotal, discount_total, tax_total, grand_total,
         display_number[nullable until finalize], created_at)
InvoiceLine (invoice FK, description, quantity, unit_price, tax_amount,
             source_type[MENU_ITEM|ROOM_CHARGE|SERVICE_CHARGE|ADJUSTMENT])
Payment (invoice FK, method[CASH|CARD|ESEWA|KHALTI|QR|BANK_TRANSFER],
         amount, reference_number[null], received_by StoreStaff FK,
         received_at, change_given[null, cash only])
```

**Resolution flow:**
- **Pay-now (dine-in/takeaway/delivery):** `Order.bill()` → `Invoice(source_type=ORDER)`, copying `OrderItem`+modifiers into `InvoiceLine`s → one or more `Payment`s recorded (split-by-method supported) → `Order.status=BILLED`.
- **Charge-to-room:** at billing time, instead of an Invoice, the order posts as `FolioLine`s onto the guest's open `Folio` (`source_order=order`); `Order.status=CHARGED_TO_ROOM`.
- **Folio close (checkout):** `Folio.close()` → `Invoice(source_type=FOLIO)`, copying **all** `FolioLine`s (room charges + restaurant charges + services) into `InvoiceLine`s → `Payment`(s) settle it in one shot → `Folio.status=CLOSED`.

One `Invoice`/`Payment` model serves both origins, so receipts, reports, and payment-method breakdowns stay uniform.

**Invoice numbering:** `display_number` (e.g. `INV-2026-000123`) is generated server-side only at `finalize()`, via a per-store transactional counter — best-effort sequential, not a strict no-gap legal sequence. `Invoice.id` is a UUID and `idempotency_key` dedupes retried submissions — this also keeps the door open for offline-generated invoices in a later phase.

### Hotel
```
RoomType (organization, store, name, base_rate, capacity)
Room (organization, store, room_type FK, number, floor, status[AVAILABLE|OCCUPIED|DIRTY|MAINTENANCE])
Reservation (organization, store, guest FK, room_type FK, room FK[null until assigned],
             check_in_date, check_out_date, status[BOOKED|CHECKED_IN|CHECKED_OUT|CANCELLED|NO_SHOW],
             adults, children, rate_per_night)
GuestStay (organization, store, reservation FK[null, for walk-ins], room FK, guest FK,
           check_in_at, check_out_at[null], status[IN_HOUSE|CHECKED_OUT])
Folio (organization, store, guest_stay FK OneToOne, status[OPEN|CLOSED], opened_at, closed_at)
FolioLine (folio FK, line_type[ROOM_CHARGE|RESTAURANT_CHARGE|SERVICE|LAUNDRY|MISC],
           description, quantity, unit_price, amount, tax_amount,
           source_order FK[null], created_by, created_at)
```
`Reservation` (the booking) is separate from `GuestStay` (actual occupancy) so walk-ins, early check-in, and no-shows don't distort the booking record. `Folio` hangs off `GuestStay`. No `PAYMENT`-type `FolioLine` in Phase 1 since settlement happens once at checkout.

### Customers/Guests — one shared model
```
Customer (organization, phone[unique per org], name, email[null], notes,
          loyalty_points[default 0, unused Phase 1], credit_balance[default 0, unused Phase 1], created_at)
```
Referenced by `Order.customer` and `Reservation.guest`/`GuestStay.guest` — no separate "guest" model. Loyalty/credit fields exist on the schema but aren't built out in Phase 1.

### Multi-tenant isolation (DRF)
- `BaseTenantModel` abstract model: `organization` FK + org-scoped manager.
- Org-resolution middleware sets `request.org` from the authenticated user's org.
- `OrgScopedViewSetMixin` applied to every ViewSet: `get_queryset()` filters by `request.org`; `perform_create()` forces `organization=request.org` (client-supplied org in payload is ignored).
- A parametrized **tenant-isolation test** across every ViewSet asserts org A's token can't read/write org B's rows by ID guessing — this is the real enforcement backstop.
- Postgres Row-Level Security as defense-in-depth is a Phase 2 hardening step, not required for Phase 1 if the mixin is applied consistently and tested.

---

## 2. Backend App Structure (Django apps)

| App | Responsibility |
|---|---|
| `core` | `BaseTenantModel`, org-resolution middleware, DRF mixins/permissions, pagination |
| `organizations` | `Organization`, `Store`, onboarding wizard state |
| `accounts` | `User`, `StoreStaff`, auth (SimpleJWT) |
| `catalog` | `MenuCategory`, `MenuItem`, `ModifierGroup`, `Modifier` |
| `tables` | `Table`, floor layout |
| `orders` | `Order`, `OrderItem`, `OrderItemModifier`, `KitchenTicket`, `KitchenTicketItem` |
| `billing` | `Invoice`, `InvoiceLine`, `Payment`, `TaxClass`, `Discount` |
| `hotel` | `RoomType`, `Room`, `Reservation`, `GuestStay`, `Folio`, `FolioLine` |
| `customers` | `Customer` |
| `reports` | Cross-app read-only aggregation endpoints (dashboard, sales, tax, payment-method) |
| `realtime` | Django Channels consumers for KDS (order/ticket status push) |
| `notifications` | Celery tasks: receipt dispatch, future SMS/email |

No `inventory`, `warehouse`, `purchasing`, or generic `products` app — intentionally out of scope for this platform.

---

## 3. API Surface (Phase 1, representative)

```
POST /api/auth/login/                POST /api/auth/refresh/          GET /api/auth/me/
GET/PATCH /api/org/                  POST /api/org/onboarding/        (pick business_type → creates Store(s))
CRUD /api/stores/                    CRUD /api/staff/
CRUD /api/menu-categories/  /api/menu-items/  /api/modifier-groups/{id}/modifiers/

GET  /api/tables/floor-view/         PATCH /api/tables/{id}/status/
POST /api/orders/                    POST /api/orders/{id}/items/
POST /api/orders/{id}/send-to-kitchen/     POST /api/orders/{id}/hold/  /resume/
POST /api/orders/{id}/bill/          POST /api/orders/{id}/charge-to-room/  {guest_stay_id}

WS   /ws/kds/{store_id}/             # Channels consumer: pushes ticket/item status changes
PATCH /api/kitchen-tickets/{id}/items/{item_id}/status/   # triggers the WS push

POST /api/invoices/                  POST /api/invoices/{id}/payments/   (call N times for split)
POST /api/invoices/{id}/finalize/    GET /api/invoices/{id}/receipt/

CRUD /api/room-types/  /api/rooms/   GET /api/rooms/status-board/
CRUD /api/reservations/              POST /api/reservations/{id}/check-in/
POST /api/guest-stays/{id}/check-out/
GET  /api/folios/{id}/               POST /api/folios/{id}/lines/   (misc charge)
POST /api/folios/{id}/close/         (→ generates settlement Invoice)

CRUD /api/customers/?search=phone
GET  /api/dashboard/summary/
GET  /api/reports/sales-daily/  /best-selling-items/  /payment-methods/  /tax-summary/
```

---

## 4. Frontend Structure (Next.js App Router)

```
/app/(auth)/login
/app/(onboarding)/setup                     # business type picker → org/store creation wizard
/app/(dashboard)/dashboard                   # today's sales/orders/GP/items sold/pending credit
/app/(pos)/pos/tables                        # floor view: available/occupied/billing
/app/(pos)/pos/order/[orderId]               # cart builder, modifiers, hold/resume, send to kitchen
/app/(pos)/pos/checkout/[orderId]            # split payment, change calc, charge-to-room, receipt print
/app/(kds)/kds                               # station tabs, full-screen kitchen display, WS-driven
/app/(hotel)/hotel/rooms                     # room status grid
/app/(hotel)/hotel/reservations
/app/(hotel)/hotel/reservations/new
/app/(hotel)/hotel/checkin/[reservationId]
/app/(hotel)/hotel/folio/[guestStayId]       # running folio + add charge + settle/checkout
/app/(admin)/admin/menu
/app/(admin)/admin/staff
/app/(admin)/admin/tables
/app/(admin)/admin/rooms
/app/(admin)/admin/settings                  # org, tax, payment method config
/app/(admin)/admin/reports
```
React Query for all server state; KDS screen subscribes to the `/ws/kds/{store_id}/` Channels socket instead of polling. A local Zustand/context store holds the in-progress POS cart before submission.

---

## 5. Phased Roadmap

### Phase 1 — MVP (build now, detailed above)
Org/user/auth + fixed roles → menu + modifiers → table management → POS ordering + WebSocket-driven KDS → universal Invoice + multi-payment billing (cash/card/eSewa/Khalti/QR/bank transfer) → receipt printing → rooms + reservations + check-in/out + folio with charge-to-room, settled once at checkout → basic dashboard + core reports (daily sales, best-sellers, payment breakdown).

### Phase 2 — Operational depth
Split bill / merge tables, held-order UX polish, `Customer` profiles with purchase/stay history surfaced in UI, `Discount`/promotions UI, refunds/voids (new `Refund` model against `Payment`), staff-performance and tax/VAT reports, DB-driven `Role`/`Permission` (replacing the enum), multi-property reporting rollups, Postgres RLS as isolation defense-in-depth, mid-stay/deposit folio payments if needed by then.

### Phase 3 — Offline & hotel maturity
Offline-capable PWA sync for POS (the UUID + idempotency-key design from Phase 1 makes this additive), housekeeping status workflow, rate plans/seasonal pricing on `RoomType`, loyalty/credit build-out on `Customer`, lightweight channel-manager considerations (flagged only, not built).

### Phase 4 — SaaS productization
Subscription plans/billing for tenants (`SubscriptionPlan`, `OrgSubscription`, usage metering), white-label theming, public API + API keys, platform-operator-level analytics across all orgs.

---

## 6. Deployment / Infra

```
docker-compose: nginx | backend(daphne/asgi) | celery-worker | celery-beat | frontend(next standalone) | postgres | redis
```
- Nginx terminates TLS (certbot), proxies `/api` and `/ws` → Daphne (ASGI, needed for Channels), `/` → Next.js, serves static/media.
- **ASGI note:** because KDS uses Channels/WebSockets, the backend runs under Daphne (or Uvicorn) instead of plain Gunicorn/WSGI from day one — HTTP views still work the same under ASGI, so this doesn't change app code, only the process/deployment layer.
- **Redis:** Celery broker/result backend + Channels layer (pub/sub for WS fan-out) + dashboard aggregate cache.
- **Celery:** async receipt print-job/notification dispatch, nightly report pre-aggregation, scheduled cleanup of abandoned `DRAFT` invoices/orders.

---

## 7. Phase 1 Verification (manual E2E)

**Restaurant flow:** create org (`business_type=RESTAURANT`) → onboarding creates default Store → seat a table (floor view AVAILABLE→OCCUPIED) → build an order with a modifier-bearing item (e.g. pizza size+toppings) → send to kitchen → confirm the ticket appears instantly on the KDS screen (via WebSocket, filtered by station) without a manual refresh → walk through NEW→COOKING→READY→SERVED and confirm each transition pushes live → bill → split payment across 2 methods (e.g. cash + eSewa) → confirm change calculation on the cash portion → finalize → verify the receipt renders correct line items/modifiers/tax and `display_number` is assigned only at finalize.

**Hotel flow:** create org (`business_type=HOTEL_RESTAURANT`) → onboarding creates a hotel Store + attached restaurant Store → create a reservation → check in (Room AVAILABLE→OCCUPIED, `GuestStay` created, `Folio` opened) → from POS, build a restaurant order and use "charge to room" targeting the guest's stay → confirm it lands as a `FolioLine` on the folio (no immediate Invoice/Payment) → add a manual misc charge (laundry) directly to the folio → checkout → confirm folio close produces exactly one settlement `Invoice` combining room charges + restaurant charge + laundry → pay it in full → confirm the Room returns to DIRTY and the GuestStay is CHECKED_OUT.

**Tenant isolation:** run the parametrized isolation test suite (org A token against org B's IDs) across all ViewSets before considering Phase 1 done.

---

## Critical Files to Start With
- `backend/core/models.py` — `BaseTenantModel`, org-scoping manager (foundation everything else depends on)
- `backend/core/permissions.py` / `backend/core/middleware.py` — tenant-isolation enforcement
- `backend/billing/models.py` — `Invoice`/`InvoiceLine`/`Payment` (the convergence point)
- `backend/orders/models.py` and `backend/hotel/models.py` — `Order.bill()`/`charge_to_room()` and `Folio.close()` resolution logic
- `backend/realtime/consumers.py` — Channels consumer for KDS push
- `frontend/app/(pos)/pos/checkout/[orderId]/page.tsx` — split-payment/charge-to-room UI
- `frontend/app/(kds)/kds/page.tsx` — WebSocket-driven kitchen screen
