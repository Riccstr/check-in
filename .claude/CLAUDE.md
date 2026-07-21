# Check-In Tracker — AI Development Guide

## Project Overview
Check-In Tracker is a field sales rep check-in and route management PWA.
Frontend: React 18 / TypeScript / Vite / Tailwind CSS / shadcn-ui.
Backend: Supabase (PostgreSQL + Auth + Storage + Edge Functions).
Hosting: Vercel (auto-deploys on push to main). Version control: GitHub (Riccstr/check-in).
Language: TypeScript throughout.

## Supabase
- Project ref: sqixgcvawufiybvyniqe
- Storage bucket: visit-photos (must remain public)
- Edge Functions: manage-users, manage-rep-user (require manual redeploy after changes)
- SQL changes run in Supabase SQL Editor only — never via code migrations

## Key Files
- src/pages/DailySchedule.tsx — Rep schedule page shell (highest risk file — contains offline sync, photo capture, realtime subscriptions, active visit guard, self-heal logic)
- src/components/schedule/ScheduleCard.tsx — Individual customer visit card component
- src/components/schedule/AdHocVisitCard.tsx — Unscheduled visit card component
- src/components/schedule/OffRouteOrderCard.tsx — Off-route order card component
- src/components/schedule/UnscheduledVisitRow.tsx — Completed unscheduled visit row component
- src/components/schedule/EodSummaryModal.tsx — End-of-day summary modal component
- src/components/schedule/ScheduleHelpers.tsx — Shared schedule utilities, constants, and styles
- src/hooks/useUnscheduledVisits.ts — Unscheduled visits fetch and state hook
- src/pages/admin/AdminDashboard.tsx — Admin dashboard with live rep status and area tags
- src/pages/admin/AdminSchedules.tsx — Schedule template management and week rotation (accordion week-cycle layout with day buttons)
- src/pages/admin/AdminVisits.tsx — All visits view with filters, soft-delete (is_deleted = true)
- src/pages/admin/AdminExports.tsx — CSV/Excel/PDF export with quick-date buttons and toast feedback
- src/pages/admin/AdminAccount.tsx — Admin profile, email/password change, 2FA placeholder, active sessions. Sign-out is now in the AdminSidebar user card, not here. Preferences block removed.
- src/pages/admin/CustomerDashboard.tsx — Per-customer visit history
- src/lib/adminUi.tsx — Admin design system: palette (A), status semantics, zar() formatter, AdminSidebar (now accepts onSignOut? prop with built-in confirm dialog), PageHeader, buttons, chips
- src/lib/offlineDb.ts — IndexedDB helpers (DB_VERSION: 7) with event-outbox stores
- src/lib/visitMachine.ts — Visit state machine: startVisit(), updateDraft(), checkOut(), skip(), logOffRoute(), editCompleted() — owns all visit invariants and orchestration
- src/lib/visitOutbox.ts — VisitEvent type definitions, makeEvent() factory, newClientId() — event type system
- src/lib/syncEngine.ts — syncVisitEvents() unified worker (events → visits + visit_events) and setupAutoSync()
- src/lib/reportData.ts — buildReportData() with single-day and multi-day schedule metric aggregation
- src/lib/timeUtils.ts — Shared time and currency formatting utilities
- src/lib/imageCompressor.ts — Photo compression before upload
- src/hooks/useAuth.tsx — Auth context
- src/hooks/useVisitDetails.ts — Shared Supabase visit lookup hook
- src/components/AppLayout.tsx — Main layout, auth guard, auto-sync setup; branches on role (admin → AdminChrome + sidebar, rep → header)
- src/App.tsx — Routes and providers

## Key Database Tables
- visits — rep_id (references reps.id NOT profiles.id), customer_id, visit_date, arrival_time, leaving_time, status, order_number, order_quantity, order_amount, photo_url, client_generated_id
- schedule_items — schedule_id, customer_id, sort_order, status, arrival_time, leaving_time, visit_id
- schedule_template_items — template_id, customer_id, sort_order. UNIQUE(template_id, sort_order)
- schedule_templates — rep_id, day_of_week, weekly_template_id, is_active
- weekly_templates — name, sort_order (1=Week 1a, 2=Week 2a, 3=Week 1b, 4=Week 2b)
- daily_schedules — rep_id, schedule_date, weekly_template_id. UNIQUE(rep_id, schedule_date)
- customer_assignments — rep_id (references reps.id), customer_id (references customers.id), links reps to their assigned customers
- customers — customer_name, account_number, area, is_active
- reps — rep_name, user_id (links to profiles/auth), is_active
- app_settings — current_week_order, week_cycle_start_date
- visit_events — append-only event log: client_id, rep_id, customer_id, visit_date, event_type (arrived|completed|skipped), event_time, created_at. Source of truth for admin live status. UNIQUE(client_id, event_type).
- sync_errors — rep_id (references reps.id), error_type, message, context (jsonb), created_at, cleared_at, cleared_by

## Database Functions
- get_week_order_for_date(p_date date) → integer 1–4. Calculates from week_cycle_start_date anchor. Never use current_week_order as a floating baseline.
- auto_generate_daily_schedule(rep_id, date) → idempotent, never runs for future dates

## visits_status_check Constraint
Valid values: visited, skipped, off_route. (in_progress remains permitted by the DB constraint for legacy rows but is never written by current code — in-progress state lives in the active_visit IDB record, not in visits.)
Any new status must be added via SQL ALTER before frontend code can write it.

## Timestamps & Timezone (UTC vs SAST)
Supabase stores `timestamptz` columns (e.g. `created_at`) in UTC. South Africa is UTC+2 (SAST).
- `created_at` (UTC) = 10:37 → `created_at_sast` (SAST) = 12:37
- **This does not affect reports or displays** — all time-sensitive columns used in reporting are plain `time` type (not `timestamptz`):
  - `visits.arrival_time` — stored as local SAST from `nowTime()` on device
  - `visits.leaving_time` — same
  - `visits.visit_date` — plain `date`, no timezone
- Only `timestamptz` columns are audit fields (`created_at`, `updated_at`, `cleared_at`), which are never used in rep-facing displays or export reports
- **Debugging**: If querying `created_at` in the Supabase SQL editor, convert to SAST with:
  ```sql
  SELECT created_at AT TIME ZONE 'Africa/Johannesburg' AS created_at_sast FROM visits;
  ```
- **Never use `created_at` as a proxy for arrival_time** — always use `arrival_time`

## Critical Patterns

### Event-Outbox Model (as of 2026-07-21)
- Three planes, one owner each: Device truth (`active_visit` IDB), server truth (visits rows born-complete at checkout), live progress (visit_events append-only log)
- Visit machine (visitMachine.ts) owns all invariants: exactly one open visit at a time, zero-duration checkout rejected, visits row never at arrival, client_generated_id generated once and reused
- Every state transition appends ONE event to visit_outbox IDB store (arrived / completed / skipped / off_route / edit)
- syncVisitEvents() drains visit_outbox in order, upserting on client_generated_id — retry-safe, same code path online or offline
- Schedule cards are prop-driven (read active_visit prop, call machine callbacks) — no internal state for arrival/leaving/notes/orders
- Scheduled visits: check-in → 'arrived' event (inserts a visit_events row ONLY — does NOT write schedule_items.arrival_time) → check-out → 'completed' event (upserts born-complete visits row AND writes arrival_time/leaving_time/status onto the linked schedule_items row via the sync worker)
- Ad-hoc visits: check-in → 'arrived' event (NEW: shows live on admin dashboard) → check-out → 'completed' event
- Off-route orders: single logOffRoute call → 'off_route' event (no 'arrived', never shows as in-progress)
- client_generated_id is the idempotency key — generated once at check-in, lives in active_visit.clientId, reused for every event of that visit, has UNIQUE constraint on visits table
- ⚠️ PENDING: AdminDashboard.tsx still reads schedule_items.arrival_time/leaving_time for live rep status and the activity feed. Because arrival_time is no longer written to schedule_items at check-in, live 'in progress / current customer' status and live check-in activity will NOT update until a visit is checked out. AdminDashboard needs a rewrite to read live status from visit_events, plus realtime replication enabled on visit_events. Until then, treat live dashboard progress as not-yet-functional.

### Architecture & Layout
- visits.rep_id references reps.id — never profiles.id or auth.users.id
- adminUi.tsx exports admin-only design system (palette A, AdminSidebar, components); rep app uses inline C palette in schedule components
- AppLayout.tsx branches on role: admin → AdminChrome (sidebar) + admin pages, rep → header + /schedule fullscreen
- AdminChrome has no top utility strip; offline status shown via OfflineStatusBar on rep header; sign-out button on AdminSidebar user card
- AdminVisits uses hard delete (.delete()); realtime subscription is INSERT + UPDATE only
- schedule_template_items GROUP BY queries must always include weekly_template_id to avoid cross-week deletions

### Week Rotation & Self-Heal
- Week self-heal runs on every fetchSchedule() call (isToday only) — compares get_week_order_for_date() to stored current_week_order and upserts correction silently
- Never pre-generate future daily_schedules — breaks week rotation on anchor change

### Off-Route & In-Progress
- In-progress state lives only in the device's active_visit IDB record — there is no in-progress visits row. A visits row appears only at checkout (born complete). Off-route orders: excluded from strike rate and visit counts, included in order value totals.

### IndexedDB & Offline
- offlineDb.ts IDB operations re-throw as `IDB_ERROR: <message>` — call sites should catch this prefix to identify storage failures
- CameraCapture tap-shield: on overlay close, a transparent full-screen shield is raised for ~500ms to absorb the ghost/compatibility click and prevent fall-through to the check-out button. capture() now calls closeCamera() directly (not setTimeout).

### UI & Mobile
- AdminSchedules uses master-detail layout: rep rail (left) + week-cycle accordion (left-centre) + day template editor (right)
- Order input fields use inputMode="numeric" for order_number and order_quantity; inputMode="decimal" for order_amount; amount uses type="text" not type="number"
- parseAmount() handles South African locale — comma decimal, space/dot thousands separators. Input "1 234,56" or "1.234,56" both parse correctly.
- calcDuration() wraps midnight crossing — arrival 23:50, checkout 00:05 = +15 minutes (not garbage negative)
- AdminVisits pagination controls centered (justifyContent: center with gap: 24) instead of space-between
- Admin edit save patches linked schedule_items row via visit_id to sync field changes to rep's daily schedule view
- Rep app is constrained to max-width 480px centred column in AppLayout.tsx; body background is #F4ECDB (cream); admin layout is completely separate
- CameraCapture video element is wrapped in div with minHeight:0 to prevent Safari/iPad flex overflow
- sync_errors RLS policy uses EXISTS (SELECT 1 FROM user_roles ...) not has_role() cast — has_role() type resolution fails in Supabase SQL editor
- AdminSidebar accepts onSignOut? prop and manages its own confirmingSignOut state internally
- viewport-fit=cover in index.html and text-size-adjust:100% in index.css prevent iPad rotation zoom
- SyncErrorPanel in AdminDashboard.tsx shows uncleared sync_errors as a fixed bottom-right badge; admins clear errors individually

### Fetch & Debounce
- reportData.ts handles both single-day and multi-day date ranges; multi-day aggregates travel time, schedule items, and calculates expectedProductiveMins as `(scheduleDaysCount * 540) - travelTimeMins`
- DailySchedule.tsx uses lastFetchTimeRef to track last fetchSchedule() call time; fetchSchedule() has a 2-second debounce window to prevent duplicate fetches
- fetchSchedule(force?: boolean) accepts force parameter to bypass debounce guard when explicitly requested (e.g., manual refresh)

## IndexedDB Stores (DB_VERSION: 7)

**Operational stores** (event-outbox model):
- active_visit — single open visit (key: "current", fields: clientId, kind, scheduleItemId, repId, customerId, customerName, visitDate, arrivalTime, notes, orderNumber, orderQty, orderAmount, photoBase64, updatedAt). Exactly one at a time (scheduled OR ad-hoc). Cleared on checkout, skip, or ad-hoc cancel (abandon).
- visit_outbox — append-only event queue (keyPath: eventId, fields per VisitEvent type: type, clientId, repId, customerId, visitDate, arrivalTime, leavingTime, durationMinutes, notes, order, status, photoBase64, syncStatus, createdAtLocal). Drained by syncVisitEvents().
- offroute_draft — off-route draft state (key: "current", fields: customer, notes, orderNumber, orderQty, orderAmount). Cleared on submit.

**Preserved cache stores**:
- cached_customers — bootstrapped customer list
- cached_schedules — bootstrapped schedules (-2 to +7 days)
- cached_user_auth — auth context for offline login

Increment DB_VERSION whenever adding or renaming a store.

## Excel / PDF Exports
- Excel: xlsx-js-style ONLY — never xlsx or exceljs (both confirmed broken)
- PDF: jspdf + jspdf-autotable, A4 landscape

## Coding Rules
- TypeScript only — no plain JS files
- No new npm packages without explicit instruction
- Create new files when it is the right structural choice (e.g. a self-contained reusable component); avoid creating new files for trivial one-off additions that belong in an existing file
- All refactoring stays in-file
- Never physically delete visits or customers — use is_deleted or is_active flags
- Camera must be triggered by user gesture only (iOS Safari requirement)
- All fixes must work on both iOS Safari and Android Chrome
- Prefer root-cause fixes — no symptom patches or workarounds
- DailySchedule.tsx is the highest-risk file in the codebase — avoid large refactors
