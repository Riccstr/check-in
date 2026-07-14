# Check-In Tracker — Architecture Reference

A **field sales representative check-in tracking application** built for companies that manage sales reps visiting customer stores on scheduled routes. Admins define weekly rotation schedules, manage customers/reps/users, and export visit reports; reps use a mobile-first PWA to log check-ins, capture timestamped photos, add notes and sales order details, and operate fully offline with automatic background sync. The stack is **React 18 / TypeScript / Vite** on the frontend, **Tailwind CSS + shadcn/ui** for styling, **Supabase** (PostgreSQL + Auth + Storage + Edge Functions) as the backend, and **Vercel** for hosting with SPA rewrite rules.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Authentication & Auth Chain](#authentication--auth-chain)
4. [Database Schema & Relationships](#database-schema--relationships)
5. [Row-Level Security Summary](#row-level-security-summary)
6. [Page Inventory](#page-inventory)
7. [Key Components](#key-components)
8. [Supabase Edge Functions](#supabase-edge-functions)
9. [Active Constraints & Design Decisions](#active-constraints--design-decisions)
10. [Offline-First Architecture](#offline-first-architecture)
11. [Scheduling System & Week Rotation](#scheduling-system--week-rotation)
12. [Environment Variables](#environment-variables)
13. [Project Structure](#project-structure)
14. [Key Libraries & Dependencies](#key-libraries--dependencies)
15. [Development Setup](#development-setup)

---

## Project Overview

Check-In Tracker enables field sales operations to:

- Define **4-week rotating visit schedules** per sales rep using configurable weekly templates
- Track **arrival/departure times** at customer locations with automatic duration calculation
- Capture **timestamped store photos** with date/time burned into the image canvas (permanent, non-metadata)
- Record **sales order details** (order number, quantity, amount) per visit
- Operate **fully offline** — visits queue to IndexedDB and sync automatically on reconnection
- Export visit data as **CSV or formatted Excel reports**
- Manage **users, roles, assignments, and schedules** from an admin-only interface

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18.3.1, TypeScript, Vite 5 |
| UI Components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS 3.4 with HSL design tokens |
| State Management | React Context (Auth), TanStack React Query 5 |
| Routing | React Router v6 |
| Backend / Database | Supabase (PostgreSQL 15) |
| Auth | Supabase Auth — email/password |
| File Storage | Supabase Storage (`visit-photos` bucket, public) |
| Backend Functions | Supabase Edge Functions (Deno) |
| Offline Storage | IndexedDB via `idb` library |
| PWA | vite-plugin-pwa (injectManifest strategy) |
| Service Worker | Custom SW: `src/sw-custom.ts` |
| Excel Export | `xlsx-js-style` |
| Hosting | Vercel (SPA rewrites via `vercel.json`) |

---

## Authentication & Auth Chain

### Login Flow

- **No public self-registration** — accounts are admin-created only
- Sign-in at `/auth` via email + password (`supabase.auth.signIn()`)
- First user auto-assigned `admin`; subsequent users auto-assigned `rep` via `auto_assign_role` trigger

### Auth Chain (Critical — Understand Before Writing RLS)

```
auth.users (Supabase managed)
    │
    ├── profiles          (id = auth.users.id)  ← full_name, login audit fields
    │
    ├── user_roles        (user_id FK → auth.users)  ← role: 'admin' | 'rep'
    │
    └── reps              (user_id FK → auth.users)  ← rep record with name/contact info
```

**Roles are never stored on `profiles` or `auth.users` metadata** — always in the `user_roles` table to prevent privilege escalation.

The `has_role(_user_id uuid, _role app_role)` function (SECURITY DEFINER) is used in all RLS policies:

```sql
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
) $$;
```

The `get_my_rep_id()` function (SECURITY DEFINER) returns the calling user's rep ID:

```sql
CREATE FUNCTION public.get_my_rep_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT id FROM public.reps WHERE user_id = auth.uid() LIMIT 1 $$;
```

### Auth Context (`src/hooks/useAuth.tsx`)

The `AuthProvider` wraps the entire app and exposes:

| Field | Type | Notes |
|-------|------|-------|
| `user` | Supabase User | Raw auth user |
| `session` | Supabase Session | JWT session |
| `role` | `'admin' \| 'rep' \| null` | From `user_roles` |
| `repId` | `uuid \| null` | Rep record PK |
| `repName` | `string \| null` | Rep's display name |
| `profile` | object | `full_name`, `created_at`, `login_updated_at`, `login_updated_by` |
| `permissions` | `string[]` | `['admin:all']` or `['rep:schedule', 'rep:visits']` |
| `roleState` | string | `'loading' \| 'ready' \| 'unassigned' \| 'offline_bootstrap_required' \| 'resolving'` |

**Offline Auth Strategy:** On load, immediately reads `cached_user_auth` from IndexedDB (instant UI), then refreshes from server in parallel. If offline with no cache → `roleState = 'offline_bootstrap_required'` (must sign in online once first).

### Customer → Rep Chain

```
customers
    └── customer_assignments  (customer_id FK → customers, rep_id FK → reps)
            └── reps           (user_id FK → auth.users)
```

A customer can be assigned to one rep. RLS on `customers` for reps uses this chain: rep can only see customers that have an assignment row pointing to their rep record.

---

## Database Schema & Relationships

### Enum

```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'rep');
```

### `profiles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Same as `auth.users.id` — FK to `auth.users` |
| `full_name` | text | Display name |
| `login_updated_at` | timestamptz | Audit: when admin last changed credentials |
| `login_updated_by` | uuid | Audit: which admin changed credentials |
| `created_at` | timestamptz | |

RLS: Users view/update own row; admins view all.

---

### `user_roles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid FK → `auth.users` | |
| `role` | `app_role` | `'admin'` or `'rep'` |

Unique: `(user_id, role)`. RLS: Users view own; admins manage all.

**Trigger `auto_assign_role()`** fires on INSERT to `auth.users`:
- If this is the first user → assigns `'admin'`
- Otherwise → assigns `'rep'` and links to the first available `reps` row with `user_id IS NULL`

---

### `reps`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid FK → `auth.users` | Nullable until "Set Login" is called |
| `rep_name` | text UNIQUE | First name |
| `surname` | text | |
| `email` | text | |
| `cell_no` | text | |
| `is_active` | boolean | Soft delete |
| `created_at` | timestamptz | |

RLS: Admins manage all; reps view own row only.

---

### `customers`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `customer_name` | text UNIQUE | Required |
| `account_number` | text UNIQUE | Optional — uniqueness enforced with 300ms debounce validation in UI |
| `area` | text | Geographic grouping |
| `is_active` | boolean | Soft delete |
| `created_at` | timestamptz | |

RLS: Admins manage all; reps can only view customers that have a `customer_assignments` row for their `rep_id`.

---

### `customer_assignments`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rep_id` | uuid FK → `reps` | |
| `customer_id` | uuid FK → `customers` | |
| `assigned_at` | timestamptz | |

Unique: `(rep_id, customer_id)`. Upsert on conflict is used. RLS: Admins manage all; reps view own assignments only (read-only for reps).

---

### `visits`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rep_id` | uuid FK → `reps` | |
| `customer_id` | uuid FK → `customers` | |
| `visit_date` | date | |
| `arrival_time` | time | |
| `leaving_time` | time | |
| `duration_minutes` | integer | Calculated: `(leaving - arrival)` in minutes |
| `notes` | text | |
| `status` | text | `'visited'`, `'skipped'`, `'in_progress'`, `'off_route'` |
| `order_number` | text | Nullable — sales order reference |
| `order_quantity` | integer | Nullable — units ordered |
| `order_amount` | numeric | Nullable — currency amount |
| `photo_url` | text | Public URL from `visit-photos` storage |
| `latitude` | double precision | Reserved (GPS — currently unused) |
| `longitude` | double precision | Reserved (GPS — currently unused) |
| `location_address` | text | Reserved (reverse geocode — currently unused) |
| `client_generated_id` | uuid UNIQUE | Client-generated UUID for offline deduplication. **Verify this constraint actually exists on the live table before relying on it for an `upsert(...).onConflict(...)` call** — it was documented here before it was actually enforced in the database, which caused every checkout to fail with Postgres 42P10 until the constraint was added via SQL Editor on 2026-07-14. |
| `created_at` | timestamptz | |

RLS: Admins manage all; reps can INSERT/SELECT/UPDATE/DELETE own visits (verified via `reps.user_id = auth.uid()`).

---

### `weekly_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | e.g., `'Week 1a'`, `'Week 1b'`, `'Week 2a'`, `'Week 2b'` |
| `sort_order` | integer | Position in rotation (1–4) |
| `is_active` | boolean | |
| `created_at` | timestamptz | |

Seeded with 4 rows. RLS: Admins manage all; all authenticated users can view.

---

### `schedule_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rep_id` | uuid FK → `reps` | |
| `day_of_week` | integer | 1=Mon … 5=Fri |
| `weekly_template_id` | uuid FK → `weekly_templates` | |
| `travel_time_minutes` | integer | Nullable — estimated travel time to first customer; used in PDF report metrics |
| `is_active` | boolean | |
| `created_at` | timestamptz | |

Unique: `(rep_id, day_of_week, weekly_template_id)`. RLS: Admins manage all; reps view own.

---

### `schedule_template_items`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `template_id` | uuid FK → `schedule_templates` | |
| `customer_id` | uuid FK → `customers` | |
| `sort_order` | integer | Visit sequence within the day |

Unique: `(template_id, customer_id)`. RLS: Admins manage all; reps view own (via `schedule_templates`).

---

### `daily_schedules`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rep_id` | uuid FK → `reps` | |
| `schedule_date` | date | |
| `weekly_template_id` | uuid FK → `weekly_templates` | Nullable — stamped at generation time; records which week template was used |
| `created_at` | timestamptz | |

Unique: `(rep_id, schedule_date)`. Auto-generated by `auto_generate_daily_schedule()`. RLS: Admins manage all; reps view own.

---

### `schedule_items`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `schedule_id` | uuid FK → `daily_schedules` | |
| `customer_id` | uuid FK → `customers` | |
| `sort_order` | integer | |
| `status` | text | `'pending'`, `'visited'`, `'skipped'` |
| `arrival_time` | time | |
| `leaving_time` | time | |
| `duration_minutes` | integer | |
| `notes` | text | |
| `visit_id` | uuid FK → `visits` | Links to the visit record once completed |

Unique: `(schedule_id, customer_id)`. RLS: Admins manage all; reps can view and update own.

---

### `app_settings`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `setting_key` | text UNIQUE | e.g., `'current_week_order'`, `'week_cycle_start_date'` |
| `setting_value` | text | |
| `updated_at` | timestamptz | |
| `updated_by` | uuid FK → `auth.users` | |

Used keys: `current_week_order` (int 1–4), `week_cycle_start_date` (date, e.g. `'2026-03-02'`). RLS: Admins manage all; all authenticated users can view.

---

### `sync_errors`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rep_id` | uuid FK → `reps` | Rep who encountered the error |
| `error_type` | text | Error category (e.g., `'ghost_card'`, `'network'`, `'validation'`) |
| `message` | text | Human-readable error description |
| `context` | jsonb | Additional error context (e.g., `{schedule_date, schedule_item_id, customer_name}`) |
| `created_at` | timestamptz | When the error was recorded |
| `cleared_at` | timestamptz | When the error was acknowledged/cleared by admin |
| `cleared_by` | uuid FK → `auth.users` | Which admin cleared the error |

RLS: Admins view/manage all; reps view own (created_at rows only, cannot clear). Writes via sync engine during offline->online reconciliation or via SyncErrorPanel when admin acknowledges.

---

### Database Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `has_role` | `(uuid, app_role) → boolean` | SECURITY DEFINER — used in every RLS policy |
| `get_my_rep_id` | `() → uuid` | SECURITY DEFINER — returns calling user's rep ID |
| `get_week_order_for_date` | `(date) → integer` | Computes rotation week (1–4) for any date based on `week_cycle_start_date` |
| `auto_generate_daily_schedule` | `(uuid, date) → uuid` | Idempotent — creates `daily_schedules` + `schedule_items` from the matching template; skips weekends and future dates; stamps `weekly_template_id` on the new row; returns null if no template exists |
| `invalidate_future_schedules` | `(p_rep_id uuid, p_day_of_week integer) → void` | Deletes future unstarted `daily_schedules` for a given rep/day-of-week when a template is saved — forces regeneration next time the rep opens those dates |
| `on_week_cycle_start_date_change` | trigger on `app_settings` | Fires when `week_cycle_start_date` is updated — calls `invalidate_future_schedules` for all reps so stale schedules regenerate from the new rotation anchor |
| `auto_assign_role` | trigger on `auth.users` | First user → admin; subsequent users → rep (links to first unlinked rep row) |
| `handle_new_user` | trigger on `auth.users` | Creates a `profiles` row on auth signup |

---

### Storage

**Bucket:** `visit-photos` (public)

- Upload path: `{rep_id}/{visit_id}.jpg`
- RLS: Authenticated reps can INSERT; authenticated users can SELECT; reps can DELETE own files
- Photos are always compressed before upload (max 1200px, 70% JPEG quality)

---

## Row-Level Security Summary

All tables have RLS enabled. The general pattern:

- **Admins:** Full access (`has_role(auth.uid(), 'admin')`)
- **Reps:** Scoped read/write via join to `reps` where `reps.user_id = auth.uid()`, or via `get_my_rep_id()`

| Table | Admin | Rep |
|-------|-------|-----|
| `profiles` | View all, manage all | View/update own |
| `user_roles` | Manage all | View own |
| `reps` | Manage all | View own |
| `customers` | Manage all | View assigned (via `customer_assignments`) |
| `customer_assignments` | Manage all | View own (read-only) |
| `visits` | Manage all | INSERT / SELECT / UPDATE / DELETE own |
| `weekly_templates` | Manage all | View all |
| `schedule_templates` | Manage all | View own |
| `schedule_template_items` | Manage all | View own (via `schedule_templates`) |
| `daily_schedules` | Manage all | View own |
| `schedule_items` | Manage all | View own, Update own |
| `app_settings` | Manage all | View all |
| `sync_errors` | Manage all, Clear own | View own (created rows only) |
| `visit-photos` bucket | Implied full | INSERT own, SELECT all, DELETE own |

Edge functions use the **service role key** and bypass RLS — they perform their own admin role check internally.

---

## Page Inventory

### Public Pages

#### `/auth` — [Auth.tsx](src/pages/Auth.tsx)
Email + password sign-in form. Calls `supabase.auth.signIn()`. Redirects to `/` on success. No DB queries.

---

### Rep Pages

#### `/` — [Index.tsx](src/pages/Index.tsx)
Role-based redirect: admin → `/admin/visits`, rep → `/schedule`. No DB queries.

#### `/schedule` — [DailySchedule.tsx](src/pages/DailySchedule.tsx) + Schedule Components
Main rep interface. Shows the day's customer visit schedule as expandable cards. Logic split across multiple files:
- **Shell:** [src/pages/DailySchedule.tsx](src/pages/DailySchedule.tsx) — page state, date navigation, real-time subscriptions
- **Card components:** [src/components/schedule/ScheduleCard.tsx](src/components/schedule/ScheduleCard.tsx), [src/components/schedule/AdHocVisitCard.tsx](src/components/schedule/AdHocVisitCard.tsx), [src/components/schedule/OffRouteOrderCard.tsx](src/components/schedule/OffRouteOrderCard.tsx), [src/components/schedule/UnscheduledVisitRow.tsx](src/components/schedule/UnscheduledVisitRow.tsx)
- **Modals/utilities:** [src/components/schedule/EodSummaryModal.tsx](src/components/schedule/EodSummaryModal.tsx), [src/components/schedule/ScheduleHelpers.tsx](src/components/schedule/ScheduleHelpers.tsx)
- **Custom hook:** [src/hooks/useUnscheduledVisits.ts](src/hooks/useUnscheduledVisits.ts)

**Tables read:** `daily_schedules`, `schedule_items`, `schedule_templates`, `weekly_templates`, `customers` (via join), `app_settings`

**Tables written:** `schedule_items` (UPDATE arrival/leaving/duration/notes/status), `visits` (INSERT/UPDATE), `visit-photos` storage (UPLOAD)

**RPCs called:** `auto_generate_daily_schedule(rep_id, date)` — idempotent, generates daily schedule from weekly template; only called for today and past dates (never for future dates)

**Notable logic:**
- Real-time subscription on `schedule_items` (filter: `schedule_id=eq.{id}`) and `daily_schedules` (filter: `rep_id=eq.{repId}`) via Supabase Realtime
- Offline queue: schedule item updates → `upsertOfflineScheduleItemUpdate()`, visits → `saveVisitOffline()` with photo as base64
- Photo capture inline within each schedule card — photo is immediately persisted to `pending_photos` IndexedDB store on capture and restored on mount; uploaded once at checkout regardless of when it was captured; falls back to `pending_photos` store on upload failure if photoBlob is null
- Active visit state (arrival time, notes, order fields) persisted to `active_card_state` IndexedDB store; restored on mount unconditionally (not gated on isExpanded) to survive backgrounding; also restores clientGenIdRef, the idempotency key reused unchanged through checkout
- Amber recovery banner shown when an in-progress item has a pending photo in IndexedDB (scroll-to + restore workflow); validated against current items to prevent stale banners after schedule regeneration
- fetchSchedule() call has 2-second debounce via lastFetchTimeRef to prevent duplicate network calls; force parameter bypasses debounce when needed
- fetchUnscheduledVisits gated by onlineFetchDoneRef to prevent double-counting when loading from IDB cache on app mount
- Future dates show "Schedule not yet available" empty state and do not trigger auto-generation
- Order fields: `order_number` (string), `order_quantity` (integer), `order_amount` (numeric); amount uses inputMode="decimal" and type="text" not type="number"
- Arrival only ever writes schedule_items.arrival_time (plain UPDATE) — no visits row is created at arrival. This is the local-first checkout architecture introduced 2026-07-13 (commit e509a51) specifically to close a recurring ghost/duplicate-visit bug family that came from tracking a server-created visit id across the whole visit duration. See CLAUDE.md's Critical Patterns for detail.
- A single visits row is created exactly once, at checkout, via `upsert(checkoutData, { onConflict: "client_generated_id" })` (online) or the offline_visits_queue (offline or on failure) — both paths use the same client_generated_id, generated once at arrival and never regenerated for the same visit, so a retried checkout can never create a second row.
- Unscheduled visit card at bottom uses a check-in/check-out flow (Option 2 — component state): rep selects customer via inline search, taps 'Tap to check in' to stamp arrival, then captures photo/notes/order, then taps 'Tap to check out' to insert the visit row directly. No schedule_item is created. Ad-hoc state persisted to `active_adhoc_state` IndexedDB store on mount and field change. Photo uploaded via `uploadAdHocPhoto()` using `repId/visitId` path matching scheduled visits.
- Off-route order card at bottom allows logging a sale outside the route — customer search, order fields, notes. Visit inserted with status `'off_route'`. Off-route state persisted to `active_offroute_state` IndexedDB store on mount and field change. Both unscheduled and off-route cards switch to the Done tab on successful submission.
- Sign-out requires confirmation dialog to prevent accidental logout.
- Completed visit cards use `VisitDetails` component with dual lookup: primary by `visit_id`, fallback by `rep_id + customer_id + visit_date` (handles offline-synced visits where `schedule_items.visit_id` may not be populated yet)
- Times displayed as HH:MM (seconds stripped via `.slice(0, 5)`) — applies to arrival, leaving, and all chip row displays

#### `/log-visit` — [LogVisit.tsx](src/pages/LogVisit.tsx)
Manual visit logging form. Intended for ad-hoc visits outside the daily schedule.

**Tables read:** `customer_assignments` (to populate customer dropdown for rep), `cached_customers` (IndexedDB fallback)

**Tables written:** `visits` (INSERT), `visit-photos` storage (UPLOAD)

**Notable logic:**
- Photo compression via `compressImage()` (max 1200px, 70% quality) then `stampImage()` burns date/time label onto image canvas
- Duration auto-calculated from arrival/leaving times
- Offline fallback: `addOfflineVisit()` queues to IndexedDB on network error
- Customer list cached in IndexedDB (`setCachedCustomers` / `getCachedCustomers`)

---

### Admin Pages

#### `/admin/dashboard` — [AdminDashboard.tsx](src/pages/admin/AdminDashboard.tsx)
Real-time dashboard showing live rep status and activity feed.

**Tables read:** `daily_schedules`, `schedule_items`, `visits`, `reps`, `customers`, `app_settings`, `sync_errors`

**Notable logic:**
- Live rep cards showing: status pill (checked_in / travelling / day_complete / not_started / no_schedule), progress meter (X/Y visits), current customer, areas served
- Status detection: checked_in if arrival_time but no leaving_time; travelling if some items left but some pending; day_complete if all visited/skipped
- Activity feed: real-time checkin, checkout, skip, and off-route events sorted by timestamp
- Uses status pills from `adminUi.tsx` with live pulse animation

**SyncErrorPanel component:**
- Fixed bottom-right component that fetches uncleared `sync_errors` (cleared_at IS NULL) on mount
- Realtime subscription on INSERT to sync_errors table; updates displayed error list automatically
- Expanded view shows list of errors with rep name, error type, message, created timestamp, and per-error clear button
- Collapsed state shows a badge with error count and danger-colored styling
- Admin can clear individual errors by clicking the "Clear" button; updates `cleared_at` and `cleared_by` fields
- Returns null if no uncleared errors exist

#### `/admin/visits` — [AdminVisits.tsx](src/pages/admin/AdminVisits.tsx)
All visits across all reps with edit/delete. Uses soft-delete (is_deleted flag) to preserve data integrity.

**Tables read:** `visits` (filtered `is_deleted = false`), `reps`, `customers`

**Tables written:** `visits` (UPDATE, DELETE via `is_deleted = true`)

**Notable logic:**
- Real-time subscription via `supabase.channel('admin-visits-realtime')` listening for **INSERT + UPDATE only** (no DELETE) — updates local state on soft-delete
- Delete action sets `is_deleted = true` (never physically removes rows)
- Columns: Date, Rep, Customer, Account #, Arrival, Leaving, Duration, Photo, Order No., Qty, Amount, Notes
- Edit modal includes all visit fields including order fields with time validation; saving patches linked schedule_items row via visit_id to sync field changes to rep's daily schedule view
- Pagination controls centered (justifyContent: center) with gap: 24 spacing
- Skipped visits highlighted with red background

#### `/admin/customers` — [AdminCustomers.tsx](src/pages/admin/AdminCustomers.tsx)
Full CRUD for customer records and rep assignments.

**Tables read:** `customers`, `customer_assignments`, `reps`

**Tables written:** `customers` (INSERT, UPDATE, DELETE), `customer_assignments` (INSERT, DELETE), `schedule_template_items` (DELETE — cascade cleanup on customer delete)

**Notable logic:**
- Account number uniqueness validated in real-time with **300ms debounce** against the `customers` table
- Permanent delete cascades: removes `schedule_template_items`, `customer_assignments`, then the `customers` row
- Filter/sort by rep, area, active status

#### `/admin/schedules` — [AdminSchedules.tsx](src/pages/admin/AdminSchedules.tsx)
Manage weekly rotation templates and view daily schedules. Master-detail layout with accordion week-cycles:
- **Rep rail** (left): Searchable rep list; selecting a rep narrows all template views
- **Week-cycle accordion** (left-centre): Four collapsible week cards (Week 1a, 1b, 2a, 2b); click card header to expand and reveal day buttons (Mon–Fri)
- **Day buttons** (revealed on expand): Mon–Fri tabs; selecting a day filters the right pane to that day's template
- **Stops list** (right): For the selected rep/week/day, shows customer sequence with account numbers and area tags; drag-to-reorder; "Add stop" or "Edit stops" button opens template editor modal
- **Settings modal** (gear icon): Manage week cycle start date and manually override the current week order

**Tables read:** `weekly_templates`, `schedule_templates`, `schedule_template_items`, `daily_schedules`, `schedule_items`, `app_settings`, `reps`, `customers`

**Tables written:** `weekly_templates` (UPDATE sort_order), `schedule_templates` (INSERT, DELETE, UPDATE), `schedule_template_items` (INSERT, DELETE, UPDATE sort_order), `daily_schedules` (DELETE — future unstarted schedules), `app_settings` (UPDATE `current_week_order`, `week_cycle_start_date`)

**RPCs called:** `get_week_order_for_date(p_date)` — called on page load to auto-calculate and sync the current week order

**Notable logic:**
- Saving a template deletes future daily schedules for that rep/day that have no started items (forces regeneration)
- Week cycle start date drives the `get_week_order_for_date()` calculation
- Current week auto-calculated on page load via `get_week_order_for_date` RPC; `app_settings.current_week_order` is updated automatically if the week has rolled over
- Manual week override updates both `current_week_order` and back-calculates `week_cycle_start_date` to keep the rotation anchor consistent

#### `/admin/reports` — [AdminExports.tsx](src/pages/admin/AdminExports.tsx)
Export visit data as CSV, formatted Excel, or PDF. Two-pane layout: **configurator (left) + live preview (right)**.

**Configurator (left):**
- Quick date buttons: Yesterday, Today, This week, This month, Custom date range
- Filter selectors: Date range (from/to), Rep, Customer, Status (visited/skipped/all)
- Export format radio buttons: CSV, Excel, PDF
- Format-specific options (e.g., "Include order details" for CSV)
- Export button with progress feedback (`toast.loading` → `toast.success` or `toast.error`)

**Live Preview (right):**
- Real-time preview of filtered data
- Paginated table view (if large dataset)
- Download button below preview

**Tables read:** `visits`, `reps`, `customers`, `daily_schedules`, `weekly_templates` (via `reportData.buildReportData()`)

**Report data logic:** [src/lib/reportData.ts](src/lib/reportData.ts)
- Builds visit summary with schedule metrics for both single-day and multi-day date ranges
- Single-day: fetches one `daily_schedule` row and its `schedule_template` to get travel time
- Multi-day: accumulates across all days in range with fetchable templates, summing travel time, schedule item count, and calculating expected productive minutes as `(scheduleDaysCount * 540) - totalTravelMins`
- Returns: total productive minutes, order totals, skip count, calculated metrics (time-per-customer, expected productive time)

**Export formats:**
- **Visits CSV:** Raw visit data with all fields including order fields (rep_id, customer_id, visit_date, arrival_time, leaving_time, notes, status, order_number, order_quantity, order_amount)
- **Averages CSV:** Aggregated per rep-customer pair (avg duration, total qty/amount)
- **Excel XLSX:** Per-rep daily report — styled headers (dark blue/white), alternating row colors, skipped visits in red, totals row (productive time, qty, amount). Times formatted as 12-hour AM/PM. Duration as `Xh Ym`. Uses `xlsx-js-style` for styling.
- **PDF (A4 landscape):** Per-rep daily visit report with branded banner (company logo top-left, rep name bold, areas + schedule day subtitle). Three equal info blocks: visit summary (left), travel metrics (centre — travel time, expected productive time, customers, time/customer), order summary (right). Visit table rows with skipped items highlighted red. Generated via `jsPDF` + `jspdf-autotable`; logo embedded as base64.

#### `/admin/customer/:customerId` — [CustomerDashboard.tsx](src/pages/admin/CustomerDashboard.tsx)
Per-customer visit history and details.

**Tables read:** `customers`, `visits`, `reps`

**Notable logic:**
- Breadcrumb: Customers > [Customer Name]
- Customer card: name, account number, area, assigned reps
- Visit table: date, rep, arrival, leaving, duration, status, order details, notes
- Filter/sort by date range, rep, status

#### `/admin/customer-chart` — [CustomerChart.tsx](src/pages/admin/CustomerChart.tsx)
Visual chart of visit frequency and duration per customer.

**Tables read:** `visits`, `customers`, `reps`

**Notable logic:**
- Lazy-loaded via `recharts` — not included in the main bundle
- Filters by rep and date range

#### `/admin/users` — [AdminUsers.tsx](src/pages/admin/AdminUsers.tsx)
Full user account lifecycle management. Two-table layout filtered by role:
- **Administrators:** All users with role `admin`
- **Field reps & pending:** All users with role `rep` or `null` (unassigned)
- **Header:** "Add User" button to create new accounts
- Each row: email, name, role, last sign-in, login audit trail (who changed password last)

**Tables read/written:** Via `manage-users` edge function (touches `auth.users`, `user_roles`, `reps`, `profiles`)

**Actions supported by manage-users:**
- `list` — fetch all Supabase users enriched with role, rep link, profile audit data
- `create_user` — create auth user + assign role in `user_roles` table
- `update_user` — update user metadata (name, etc.)
- `update_role` — change role (admin ↔ rep)
- `update_email` — change user email
- `reset_password` — set new password + update audit timestamps
- `delete_user` — remove from `user_roles` + `auth.users` (unlinks from rep record)

**Notable logic:**
- Login audit trail from `profiles.login_updated_at` / `login_updated_by`
- Self-deletion blocked (admin cannot delete own account)
- Role change (admin ↔ rep) updates `user_roles` table

#### `/admin/account` — [AdminAccount.tsx](src/pages/admin/AdminAccount.tsx)
Admin's own email/password settings and active sessions. Sign-out is now located in the AdminSidebar user card (not here).

**Functional sections:**
- **Email change:** Update email via `supabase.auth.updateUser()` with confirmation link workflow
- **Password change:** Update password via `supabase.auth.updateUser()` with strength meter (6 chars min, uppercase+lowercase+numbers recommended)
- **Active sessions:** Shows current device (user agent) and last sign-in timestamp

**Placeholder sections (TODO backend wiring):**
- **2FA (Two-Factor Authentication):** UI present, toggle controls not yet implemented; "Coming soon" label shown

---

## Key Components

### [AppLayout.tsx](src/components/AppLayout.tsx)
Main layout wrapper used on every authenticated page. Branches on user role:
- **Admins:** Render `AdminChrome` (left sidebar via `AdminSidebar` from `adminUi.tsx`) + page content
- **Reps:** Render traditional header layout + `/schedule` fullscreen path (no chrome)
- **Chrome hiding logic:** When `role === 'rep' && pathname === '/schedule'`, chrome is hidden for fullscreen UX
- **Common responsibilities:**
  - Auth guard — redirects unauthenticated users to `/auth`
  - Calls `setupAutoSync()` for reps on mount to start background sync loop (checks every 5s if online)
  - Handles `offline_bootstrap_required` state (shows guidance screen)
  - Route persistence: saves current path to `localStorage` for mobile background/restore
- **AdminChrome:** Container for admin pages with `AdminSidebar` (left) and flexible main area (right). No top utility strip. Sign-out button now in AdminSidebar user card (passed via `onSignOut` prop).
- Consumed by: every page

### [adminUi.tsx](src/lib/adminUi.tsx) — *Admin-only design system*
Centralized palette, components, and utilities for all admin pages. **Admin-only** (rep app uses inline `C` palette in DailySchedule.tsx).

**Exports:**
- **Palette:** `A` object with semantic colors (deep green `#1B5238`, cream `#F4ECDB`, sun `#C68A1F`, etc.), typefaces (`Inter`, `JetBrains Mono`)
- **Status:** `RepStatusKey` type and `STATUS_META` for pill rendering (checked_in, travelling, day_complete, not_started, no_schedule)
- **Currency formatter:** `zar(n, opts)` — formats amounts as R-formatted numbers with optional compact notation
- **Keyframes:** `PulseKeyframes()` — mounts once at App root to enable live indicator animations
- **Sidebar:** `AdminSidebar({ userInitials, userName, userSubtitle, onSignOut? })` — vertical left rail (224px) with nav items + user card. When `onSignOut` prop is provided, user card displays a sign-out button (LogOut icon). Clicking triggers a confirmation dialog with danger-themed styling (red background, white text) before calling `onSignOut()`
- **Components:** `PageHeader`, `Pill`, `Tag`, `StatCard`, `FilterChip`, `PrimaryButton`, `GhostButton`, `ToolbarSearch`
- **Used by:** All admin pages (`AdminDashboard`, `AdminCustomers`, `AdminSchedules`, `AdminVisits`, `AdminExports`, `AdminUsers`, `AdminAccount`)

### [CameraCapture.tsx](src/components/CameraCapture.tsx)
Full-screen camera overlay for taking store photos.
- Uses `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
- **iOS requirement:** Must be triggered by a user gesture (tap) — cannot auto-open camera
- Captures frame to canvas as JPEG blob; burns timestamp onto image (date/time in white text on semi-transparent black background, bottom-right)
- **Callback ordering:** Calls `onCapture(blob)` before `setTimeout(closeCamera, 0)` to ensure blob is fully processed by parent component before modal closes. This prevents Android touch propagation issues.
- **Video overflow fix:** Video element wrapped in div with `{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }` to prevent Safari/iPad flex overflow. Video uses `{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }` for proper scaling.
- **Safe area insets:** Overlay container uses CSS `env(safe-area-inset-top/left/right)` padding when open; capture button bar uses `env(safe-area-inset-bottom)` to push above notch/home indicator on iPhone X+
- Overlay has `pointer-events: auto` when open, `pointer-events: none` when closed to prevent touch interference with background elements (Android/iPad fix)
- Consumed by: [DailySchedule.tsx](src/pages/DailySchedule.tsx), [LogVisit.tsx](src/pages/LogVisit.tsx)

### `AdminChrome` — *Sidebar wrapper for admin pages*
Component defined inline in [AppLayout.tsx](src/components/AppLayout.tsx). Wraps all admin pages with:
- Vertical sidebar (left) — `AdminSidebar` with nav menu + user card
- Top utility strip (right) — offline indicator + sign-out button
- Flexible main area for page content
- Used by: AppLayout when `role === 'admin'`

### [OfflineStatusBar.tsx](src/components/OfflineStatusBar.tsx)
Visual banner displayed when `navigator.onLine === false`. Uses `useOnlineStatus` hook.
Consumed by: [AppLayout.tsx](src/components/AppLayout.tsx)

### [NavLink.tsx](src/components/NavLink.tsx)
Styled navigation anchor with active/inactive variants using `.nav-link-active` / `.nav-link-inactive` CSS classes.
Consumed by: [AppLayout.tsx](src/components/AppLayout.tsx)

### [SearchableSelect.tsx](src/components/ui/searchable-select.tsx)
Reusable searchable combobox used for all customer and rep dropdowns across admin and rep pages. Wraps Radix `Popover` + `cmdk` `Command` pattern.
- **Props:** `options`, `value`, `onValueChange`, `placeholder`, `searchPlaceholder`, `emptyMessage`, `className`, `includeAll` (prepends an "All" option), `allLabel`
- Trigger button stays compact (caller-specified width); popover expands to `min-w-[400px]`, capped at `100vw - 2rem` on mobile
- Search input has `font-size: 16px` to prevent iOS auto-zoom
- **Used on:** All Visits, Export Data, My Visits, Log Visit, Assignments (rep + customer selectors), Schedules (rep selector)

### `src/components/ui/` — shadcn/ui Component Library
50+ components built on Radix primitives: `Button`, `Input`, `Select`, `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `Table`, `Tabs`, `Badge`, `Checkbox`, `Label`, `Textarea`, `Toast` (Radix + Sonner implementations), `Card`, etc. Used throughout all pages.

---

## Supabase Edge Functions

Both functions are configured with `verify_jwt = false` in `supabase/config.toml` because they handle auth verification internally using the **service role key**.

### `manage-rep-user` — [supabase/functions/manage-rep-user/index.ts](supabase/functions/manage-rep-user/index.ts)

**Called by:** [AdminReps.tsx](src/pages/admin/AdminReps.tsx)

**Security:** Verifies caller has `'admin'` role in `user_roles` table using the service role key.

| Action | What it does |
|--------|-------------|
| `create` | Creates a Supabase auth user (email + password), sets user metadata, updates `reps.user_id` to link the auth user to the rep record |
| `update` | Updates `reps` table fields (name, email, etc.) and optionally updates the auth user's email/password |

**Validation:** Email format, password 6–72 chars, strings < 255 chars. Sanitizes DB/auth error messages before returning.

---

### `manage-users` — [supabase/functions/manage-users/index.ts](supabase/functions/manage-users/index.ts)

**Called by:** [AdminUsers.tsx](src/pages/admin/AdminUsers.tsx)

**Security:** Verifies caller has `'admin'` role; rejects non-admins with HTTP 403.

| Action | What it does |
|--------|-------------|
| `list` | Returns all Supabase auth users enriched with `user_roles`, linked `reps` record, `profiles` data (including login audit fields) |
| `create_user` | Creates auth user with `email_confirm: true` (bypasses email confirmation), assigns role in `user_roles` |
| `update_user` | Updates user metadata (full_name, etc.) in `auth.users.user_metadata` |
| `update_role` | Updates `user_roles` table for the given `user_id` (admin ↔ rep) |
| `update_email` | Changes user email in `auth.users` |
| `reset_password` | Sets new password via admin API with `email_confirm: true`; updates `profiles.login_updated_at/by` |
| `delete_user` | Unlinks from `reps` (sets `user_id = null`), removes from `user_roles`, deletes from `auth.users`; blocks self-deletion |

---

## Active Constraints & Design Decisions

### 1. Account Number Uniqueness Enforcement

`customers.account_number` has a PostgreSQL UNIQUE constraint. In [AdminCustomers.tsx](src/pages/admin/AdminCustomers.tsx), the account number input validates against the database in real-time with a **300ms debounce** — an inline error is shown before the user submits. This prevents silent unique-constraint failures on insert.

### 2. Date/Time Stamp Burned onto Photos via Canvas

Photos are **never** stored with metadata-only timestamps. In [`src/lib/imageCompressor.ts`](src/lib/imageCompressor.ts), `stampImage(blob, label)` draws the date/time string (format: `DD/MM/YYYY HH:MM:SS`) directly onto the image canvas using a semi-transparent black background with white text sized at 2.8% of image width, positioned at the bottom-right corner. Font: `Arial`, weight `bold`. The result is re-encoded as JPEG at 88% quality. This makes the timestamp permanent and visible even if the file is shared outside the app.

### 3. RLS Admin Role Requirement

Every Supabase query from the frontend relies on RLS. The `has_role()` SECURITY DEFINER function is the single source of truth for role checks. **Do not** move role data to `auth.users.app_metadata` or `profiles` — the entire RLS policy structure assumes `user_roles` is the authoritative table.

### 4. iOS `getUserMedia` Gesture Requirement

Safari on iOS blocks `navigator.mediaDevices.getUserMedia()` unless called from within a user gesture handler (tap event). In [CameraCapture.tsx](src/components/CameraCapture.tsx), camera activation is always triggered by a button `onClick`. **Never** attempt to auto-open the camera on page load or in `useEffect` without a gesture chain — it will fail silently on iOS.

### 5. Service Worker Caching Strategy

Defined in [`src/sw-custom.ts`](src/sw-custom.ts), registered via `vite-plugin-pwa` with `injectManifest` strategy:

| Route / Asset Type | Strategy | Cache Name | Max Entries | Max Age |
|---|---|---|---|---|
| Supabase API (`*.supabase.co`) | NetworkOnly | — | — | — |
| JS / CSS bundles | CacheFirst | `static-code-v1` | 60 | 30 days |
| Images / Fonts | CacheFirst | `static-assets-v1` | 120 | 30 days |
| HTML / SPA navigation | NetworkFirst | — | — | — |

On **activate**, the SW calls `clients.claim()` and re-caches `index.html` (via `refreshIndexHtml()`) to ensure the latest shell is served after an update. On **install**, `skipWaiting()` forces immediate takeover.

**Do not** add Supabase API calls to any cache strategy — they must always go to the network.

### 6. Vercel SPA Rewrite Rules

`vercel.json` contains a catch-all rewrite rule so that direct navigation to any route (e.g. `/admin/visits`) returns `index.html` instead of a 404:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Without this rule, refreshing any non-root route in production returns a 404 from Vercel's CDN.

### 7. Rep App Width Constraint

The rep-facing PWA is constrained to max-width 480px centred in [AppLayout.tsx](src/components/AppLayout.tsx) with cream (#F4ECDB) flanking background. This applies to both the header and main content area. The constraint is enforced via inline styles on the rep branch (not the admin branch). The `<style>` tag in the component sets `body { background-color: #F4ECDB; }`. The admin layout (`AdminChrome`) is a completely separate branch and is unaffected by any width constraints — it uses full viewport width.

---

## Offline-First Architecture

### IndexedDB Schema (`src/lib/offlineDb.ts`)

Database name: `checkin-tracker-offline`, version **6** (increment version if adding stores)

| Store | Key | Stored Data |
|-------|-----|-------------|
| `offline_visits_queue` | `client_generated_id` | Full visit payload + `photo_base64` (JPEG data URL) + `sync_status` — the single mechanism that creates/updates visits rows, synced via `upsert(..., { onConflict: "client_generated_id" })` |
| `offline_schedule_item_updates` | `schedule_item_id` | Schedule item update payload + sync metadata. `visitId` field is legacy — no current code sets it; kept so old queued entries from before commit e509a51 can still drain safely |
| `cached_customers` | `id` | `{id, customer_name, account_number, area}` |
| `cached_schedules` | `key` (`{repId}_{date}`) | Full daily schedule + items |
| `cached_user_auth` | `user_id` | `{role, rep_id, rep_name, profile, permissions, cached_at}` |
| `pending_photos` | `scheduleItemId` | `{scheduleItemId, base64, visitId, clientGeneratedId}` — photo captured during active visit, base64 stored intentionally for iOS Safari IDB Blob compatibility. `visitId` populated only when a visits row was created but its storage upload specifically failed. |
| `active_card_state` | `key` (`"current"`) | `{scheduleItemId, arrivalTime, notes, clientGeneratedId, orderNumber, orderQty, orderAmount}` — in-progress visit card state, cleared on checkout. `visitId` field is @deprecated on the type, no longer written. |
| `active_adhoc_state` | `key` (`"adhoc"`) | `{customer, arrivalTime, notes, photo, orderNumber, orderQty, orderAmount}` — unscheduled visit card state, restored on mount, persisted on field change |
| `active_offroute_state` | `key` (`"offroute"`) | `{customer, notes, orderNumber, orderQty, orderAmount}` — off-route order card state, restored on mount, persisted on field change |

### Sync Engine (`src/lib/syncEngine.ts`)

Triggered by:
- `online` DOM event (1.5s delay)
- `visibilitychange` → visible, when online (1s delay)
- App load when online (2s delay)
- Manual "Sync Now" button in [MyVisits.tsx](src/pages/MyVisits.tsx)

**Visit sync flow (idempotent):**
1. Get all `pending` / `error` visits from IndexedDB, sorted by `created_at_local`
2. Per visit: `upsert` into `visits` with `{ onConflict: "client_generated_id" }` — a retried sync of an already-synced entry resolves to the same row instead of racing a separate SELECT check against a concurrent sync pass (this replaced a select-then-insert pattern in commit e509a51 — do not reintroduce it)
3. On success: `linkVisitToScheduleItem()` updates the matching `schedule_items` row; upload `photo_base64` to `visit-photos` bucket; UPDATE `visits.photo_url`
4. Mark as `synced` in IndexedDB; remove synced records after pass completes

**Schedule item sync:** Updates `schedule_items` fields (arrival/leaving/duration/notes/status) from `offline_schedule_item_updates` queue.

### Offline Bootstrap (`src/lib/offlineBootstrap.ts`)

On first successful online sign-in, pre-caches:
- Assigned customers list → `cached_customers`
- Daily schedules for window `-2` to `+7` days → `cached_schedules`
- User auth context → `cached_user_auth`

This enables full offline operation after a single online session. If a user has never signed in online, `roleState` becomes `'offline_bootstrap_required'`.

---

## Scheduling System & Week Rotation

### 4-Week Rotation

Four `weekly_templates` (Week 1a, 1b, 2a, 2b) with `sort_order` 1–4. A reference date (`week_cycle_start_date`) in `app_settings` anchors the rotation.

### `get_week_order_for_date(p_date date) → integer`

```
weeks_elapsed = floor((p_date - week_cycle_start_date) / 7)
week_index = ((weeks_elapsed % total_active_templates) + total_active_templates) % total_active_templates + 1
```

Handles negative values (dates before the cycle start). Returns `1`–`4`.

### `auto_generate_daily_schedule(p_rep_id, p_schedule_date) → uuid`

1. Check if `daily_schedules` row already exists (idempotent)
2. Skip if `ISODOW > 5` (weekend)
3. **Skip if `p_schedule_date > CURRENT_DATE`** (future-date guard — never pre-generate)
4. Call `get_week_order_for_date()` to determine week
5. Find `schedule_templates` row for `(rep_id, day_of_week, weekly_template_id.sort_order = week_order)`
6. Create `daily_schedules` row; stamp `weekly_template_id`
7. Copy `schedule_template_items` → `schedule_items` with same `sort_order`
8. Returns the new `daily_schedule.id`; returns `NULL` if no template, empty template, or future date

The frontend in [DailySchedule.tsx](src/pages/DailySchedule.tsx) also enforces this: `auto_generate_daily_schedule()` is only called when `scheduleDate <= todayStr`. Future dates show a "Schedule not yet available" empty state.

### Manual Week Override

When an admin manually sets the current week in [AdminSchedules.tsx](src/pages/admin/AdminSchedules.tsx), **both** `app_settings` keys are updated atomically via upsert:
- `current_week_order` — the selected week number (1–4)
- `week_cycle_start_date` — back-calculated to the Monday of the week that would yield this week number, so `get_week_order_for_date()` returns the correct value for all past and future dates

This ensures the rotation anchor remains consistent after a manual correction.

### Template Save → Regeneration

When admin saves a template, [AdminSchedules.tsx](src/pages/admin/AdminSchedules.tsx) deletes future `daily_schedules` rows for that rep/day where no items have been started (no arrivals, no visited/skipped status). Next time the rep opens that date, `auto_generate_daily_schedule()` runs again from the updated template.

---

## Environment Variables

All required. Never commit actual values.

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project REST/Auth/Realtime base URL (e.g., `https://<project-ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous/public key — used by the frontend Supabase client for all authenticated requests |

Edge functions access the **service role key** via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` — this is injected automatically by Supabase and is never exposed to the frontend.

---

## Project Structure

```
src/
├── assets/                    # Static assets (logo)
├── components/
│   ├── schedule/              # Rep schedule page components (split from DailySchedule)
│   │   ├── ScheduleCard.tsx           # Individual customer visit card
│   │   ├── AdHocVisitCard.tsx         # Unscheduled visit card
│   │   ├── OffRouteOrderCard.tsx      # Off-route order card
│   │   ├── UnscheduledVisitRow.tsx    # Completed unscheduled visit row
│   │   ├── EodSummaryModal.tsx        # End-of-day summary dialog
│   │   └── ScheduleHelpers.tsx        # Shared utilities, constants, styles
│   ├── ui/                    # shadcn/ui components (50+)
│   ├── AppLayout.tsx          # Main layout, auth guard, auto-sync setup
│   ├── CameraCapture.tsx      # Full-screen camera overlay
│   ├── NavLink.tsx            # Styled nav link
│   ├── OfflineStatusBar.tsx   # Offline indicator banner
│   └── PullToRefresh.tsx      # Pull-to-refresh handler
├── hooks/
│   ├── useAuth.tsx            # Auth context provider — role, repId, profile, permissions
│   ├── useOnlineStatus.ts     # navigator.onLine + event listeners
│   ├── useUnscheduledVisits.ts    # Unscheduled visits fetch hook
│   ├── useVisitDetails.ts     # Shared Supabase visit lookup hook
│   ├── use-mobile.tsx         # Mobile breakpoint detection
│   └── use-toast.ts           # Toast hook
├── integrations/
│   └── supabase/
│       ├── client.ts          # Supabase client init — reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
│       └── types.ts           # Auto-generated DB types — DO NOT EDIT manually
├── lib/
│   ├── adminUi.tsx            # Admin design system: palette (A), components, sidebar
│   ├── imageCompressor.ts     # compressImage(), stampImage(), blobToBase64(), base64ToBlob()
│   ├── offlineBootstrap.ts    # Pre-cache customers/schedules/auth on first online login
│   ├── offlineDb.ts           # All IndexedDB read/write operations (DB_VERSION: 6)
│   ├── reportData.ts          # buildReportData() with single/multi-day schedule metrics
│   ├── syncEngine.ts          # syncPendingVisits(), syncPendingScheduleItemUpdates()
│   ├── timeUtils.ts           # Shared time and currency formatting utilities
│   └── utils.ts               # cn() Tailwind merge utility
├── pages/
│   ├── Auth.tsx               # /auth — login form
│   ├── DailySchedule.tsx      # /schedule — rep daily schedule (page shell)
│   ├── Index.tsx              # / — role-based redirect
│   ├── LogVisit.tsx           # /log-visit — manual visit form
│   ├── MyVisits.tsx           # /my-visits — completed visits list
│   ├── Averages.tsx           # /averages — rep performance metrics
│   ├── NotFound.tsx           # * — 404
│   └── admin/
│       ├── AdminAccount.tsx   # /admin/account — admin profile & settings (with sign-out)
│       ├── AdminCustomers.tsx # /admin/customers — customer CRUD + assignments
│       ├── AdminDashboard.tsx # /admin/dashboard — live rep status + activity feed
│       ├── AdminExports.tsx   # /admin/reports — CSV, Excel, PDF export
│       ├── AdminSchedules.tsx # /admin/schedules — template management + week rotation
│       ├── AdminUsers.tsx     # /admin/users — user account lifecycle
│       ├── AdminVisits.tsx    # /admin/visits — all visits with edit/soft-delete
│       ├── CustomerDashboard.tsx # /admin/customer/:customerId — per-customer history
│       └── CustomerChart.tsx  # /admin/customer-chart — recharts visit frequency
├── sw-custom.ts               # Custom service worker (caching routes)
├── App.tsx                    # Root: router, providers, PulseKeyframes
├── index.css                  # Tailwind directives + HSL design tokens
└── main.tsx                   # Entry point

supabase/
├── config.toml                # Edge function config (verify_jwt = false for both functions)
├── functions/
│   ├── manage-rep-user/index.ts   # Create/update rep auth accounts
│   └── manage-users/index.ts      # Full user lifecycle (list, create, role, password, delete)
└── migrations/                # PostgreSQL migrations — DO NOT EDIT

public/
├── favicon.ico
├── logo.png
├── pwa-192x192.png
├── pwa-512x512.png
└── robots.txt

vercel.json                    # Build config + SPA catch-all rewrite rule
vite.config.ts                 # Vite + PWA plugin config (injectManifest, sw-custom.ts)
```

---

## Key Libraries & Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@supabase/supabase-js` | ^2.95.3 | DB, Auth, Storage, Realtime, Edge Functions |
| `@tanstack/react-query` | ^5.83.0 | Server state management |
| `react-router-dom` | ^6.30.1 | Client-side routing |
| `idb` | ^8.0.3 | IndexedDB wrapper (offline storage) |
| `uuid` | ^13.0.0 | Client-generated UUIDs for offline deduplication |
| `xlsx-js-style` | ^1.2.0 | Excel export with cell styling — never replace with xlsx or exceljs (both confirmed broken) |
| `jspdf` | ^4.2.1 | PDF generation for daily visit reports |
| `jspdf-autotable` | ^5.0.7 | Auto-layout tables within jsPDF documents |
| `date-fns` | ^3.6.0 | Date formatting |
| `sonner` | ^1.7.4 | Toast notifications |
| `lucide-react` | ^0.462.0 | Icons |
| `vite-plugin-pwa` | ^1.2.0 | PWA + service worker injection |
| `zod` | ^3.25.76 | Schema validation |
| `react-hook-form` | ^7.61.1 | Form state management |
| `recharts` | ^2.15.4 | Charts — used in [CustomerChart.tsx](src/pages/admin/CustomerChart.tsx) (lazy-loaded) |

---

## Development Setup

```bash
# Install dependencies
npm install

# Start development server (port 8080)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Run tests
npm test
```

Copy `.env.example` to `.env` and fill in your Supabase project values:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

---

## Important Notes for AI-Assisted Development

1. **Unscheduled visit uses Option 2 (component state only)** — no schedule_item is created. Visit is inserted directly on checkout. There is no IDB recovery if the app backgrounds mid-visit on an unscheduled card.
2. **uploadAdHocPhoto() is a standalone helper at DailySchedule level** — uploads to `repId/visitId.jpg` matching the scheduled visit storage path. Falls back to `savePendingPhoto` queue on failure.
3. **fmtDuration() returns 'X min' format** (not 'Xm') for values under 60 minutes — affects all duration displays including the stats card and Done tab.
4. **Bottom action cards (Unscheduled + Off-Route) remove horizontal padding when expanded** — the wrapper uses conditional padding: `expandedBottomCard === null ? '8px 16px' : '8px 0'` to align expanded cards with customer cards above.
5. **Never suggest xlsx or exceljs** — `xlsx-js-style` only (both confirmed broken).
6. **Never store roles in `profiles` or `auth.users` metadata** — always use `user_roles` table; all RLS depends on it
7. **Never edit auto-generated files:** `src/integrations/supabase/client.ts`, `types.ts`, `supabase/config.toml`
8. **IndexedDB schema version must be incremented** in `offlineDb.ts` if you add/rename any object stores
9. **`client_generated_id` is the deduplication key** — always set it client-side (UUID v4) before inserting a visit; the sync engine uses it to prevent double-submit
10. **Photos are always compressed** before storage (`compressImage` → `stampImage`) — never upload raw camera output
11. **Camera must be triggered by a user gesture** on iOS — no auto-open in `useEffect`
12. **Edge functions use service role key** and handle their own admin check — do not rely on JWT/RLS inside edge functions
13. **Template saves delete future unstarted daily schedules** — this is intentional to force regeneration from the updated template
14. **`auto_generate_daily_schedule` is idempotent** — safe to call multiple times; it will not create duplicate schedules
15. **Supabase API routes must use NetworkOnly** in the service worker — never cache auth or database responses
16. **The sync engine is idempotent** — re-running it never creates duplicates thanks to the `client_generated_id` UNIQUE constraint and the `upsert(..., { onConflict: "client_generated_id" })` call. This constraint is load-bearing — if it's ever missing on the live table, every upsert fails with Postgres error 42P10. Verify it exists directly in the DB if this class of error resurfaces; do not assume from documentation alone.
17. **Account number uniqueness** is enforced at both DB level (UNIQUE constraint) and UI level (debounced real-time check) — both layers are needed
18. **`auto_generate_daily_schedule` must never run for future dates** — the guard exists in both the SQL function (`p_schedule_date > CURRENT_DATE` → return null) and the frontend (`scheduleDate <= todayStr`). Do not remove either guard; pre-generating future schedules breaks the week-rotation logic when the anchor changes
19. **Manual week override must update both `app_settings` keys** — setting only `current_week_order` is not enough; `week_cycle_start_date` must also be back-calculated and upserted so `get_week_order_for_date()` stays consistent for all dates
20. **Photo persistence uses two IndexedDB stores** — `pending_photos` (keyed by `scheduleItemId`) holds the base64-encoded photo from capture until checkout; `active_card_state` (key `"current"`) holds arrival time and notes. Both are cleared in the `updateItem` finally block when status becomes `visited` or `skipped`. **Do not** clear them earlier or the recovery banner will never trigger
21. **`xlsx-js-style` replaces `xlsx`** — do not revert to `xlsx`; the cell-level styling API (`s: { fill, font, alignment }`) is incompatible with the base library. The package is already listed in `package.json`; no further changes needed
22. **PDF report banner text layout depends on `TEXT_X = ML + 19`** — this offset accounts for the logo width (14mm) + left margin + padding. If the logo is resized, update `TEXT_X` accordingly. The three info blocks are each exactly 92mm wide (`(PW - ML - MR) / 3 = 276 / 3`); changing `ML` or `MR` breaks the equal-width layout
23. **`offlineDb.ts` IDB operations all throw `IDB_ERROR: <message>`** on failure — call sites should catch errors prefixed with `IDB_ERROR:` to identify storage failures and surface feedback to the user
24. **`offline_schedule_item_updates` uses `schedule_item_id` as keyPath intentionally** — the sync pattern is state snapshotting; the checkout payload includes all fields (arrival_time, leaving_time, status, notes, orders). Do not redesign to auto-increment
25. **`adHocPhoto` in `DailySchedule.tsx` is stored as `{ blob: Blob; preview: string } | null`** — base64 conversion happens lazily only in the offline/error fallback path. Object URLs are revoked on clear and reset
26. **Ad-hoc and off-route form state persisted to IndexedDB** — `active_adhoc_state` and `active_offroute_state` stores preserve customer, order fields, and notes across app backgrounding. Restored on component mount and persisted on every field change. Cleared on submit or reset.
27. **fetchSchedule() debounced with 2-second window via lastFetchTimeRef** — prevents duplicate network calls when app load, visibility change, and online event fire in quick succession. force parameter bypasses debounce for manual refresh.
28. **onlineFetchDoneRef gates fetchUnscheduledVisits on app mount** — prevents double-counting visits when loading from IDB cache. The flag is set after the first successful online fetch and gates subsequent fetches until the next day.
29. **clientGenIdRef restored unconditionally on ScheduleCard mount** — not gated on isExpanded. This ensures that if a rep was in the middle of a visit when the app backgrounded, the visit context is immediately restored, and the same checkout idempotency key (`client_generated_id`) is reused, preventing duplicate visits on reopen. The `activeVisitId` field was removed in commit e509a51 (local-first checkout refactor) — there is no longer a separate tracked-id-to-PATCH model.
30. **CameraCapture callback ordering: onCapture(blob) before closeCamera()** — ensures blob is fully processed by the parent component before the modal closes. This ordering combined with pointer-events management (auto when open, none when closed) prevents Android touch propagation issues and ensures reliable photo capture.
31. **sync_errors RLS uses EXISTS subquery, not has_role() cast** — the RLS policy for sync_errors was created with a raw `EXISTS (SELECT 1 FROM user_roles ...)` subquery instead of the `has_role()` function because the app_role cast fails in the Supabase SQL editor. Never replace this with `has_role()` without testing in production; the type resolution issue is environment-specific.
32. **The rep app max-width constraint lives in AppLayout.tsx rep branch only** — the width constraint (`maxWidth: 480px`) and cream background (`#F4ECDB`) are applied only when `role !== 'admin'`. The AdminChrome branch is completely unaffected and uses full viewport width. Never apply width constraints to the AdminChrome branch or admin pages.
33. **CameraCapture video must always be inside a div with minHeight:0** — removing this wrapper causes Safari/iPad to overflow the video element over the capture button. The wrapper allows the video to shrink below its content size within the flex layout; without it, the video stretches and breaks the layout on iPad.
34. **viewport-fit=cover in index.html is required for safe-area-inset CSS** — the CSS environment variables (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, etc.) only work when `viewport-fit=cover` is set in the viewport meta tag. Without this, safe-area insets are always zero and notched devices (iPhone X+, iPad Pro with notch) will have content hidden under hardware features.
35. **text-size-adjust:100% prevents unwanted iOS Safari zoom-on-orientation-change** — Safari on iOS/iPad auto-magnifies text when rotating from portrait to landscape. Setting `-webkit-text-size-adjust: 100%` and `text-size-adjust: 100%` on all elements via the universal selector in index.css prevents this unwanted reflow. This rule is applied globally to the entire document.
