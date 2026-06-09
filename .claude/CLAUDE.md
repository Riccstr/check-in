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
- src/pages/DailySchedule.tsx — Rep schedule page (highest risk file — contains offline sync, photo capture, realtime subscriptions, active visit guard, self-heal logic)
- src/pages/admin/AdminDashboard.tsx — Admin dashboard with live rep status and area tags
- src/pages/admin/AdminSchedules.tsx — Schedule template management and week rotation (master-detail layout)
- src/pages/admin/AdminVisits.tsx — All visits view with filters, soft-delete (is_deleted = true)
- src/pages/admin/AdminExports.tsx — Excel/PDF export (two-pane configurator + preview)
- src/pages/admin/CustomerDashboard.tsx — Per-customer visit history
- src/lib/adminUi.tsx — Admin design system: palette (A), status semantics, zar() formatter, AdminSidebar, PageHeader, buttons, chips
- src/lib/offlineDb.ts — IndexedDB helpers (DB_VERSION: 5)
- src/lib/reportData.ts — buildReportData() and ReportData interface (extracted from AdminExports.tsx)
- src/lib/timeUtils.ts — shared time and currency formatting utilities
- src/lib/imageCompressor.ts — Photo compression before upload
- src/hooks/useAuth.tsx — Auth context
- src/hooks/useVisitDetails.ts — shared Supabase visit lookup hook used by VisitDetailsText and VisitPhotoOnly
- src/components/AppLayout.tsx — Nav and layout; branches on role (admin → AdminChrome + sidebar, rep → header)
- src/App.tsx — Routes

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

## Database Functions
- get_week_order_for_date(p_date date) → integer 1–4. Calculates from week_cycle_start_date anchor. Never use current_week_order as a floating baseline.
- auto_generate_daily_schedule(rep_id, date) → idempotent, never runs for future dates

## visits_status_check Constraint
Valid values: visited, skipped, in_progress, off_route
Any new status must be added via SQL ALTER before frontend code can write it.

## Critical Patterns
- visits.rep_id references reps.id — never profiles.id or auth.users.id
- adminUi.tsx exports admin-only design system (palette A, AdminSidebar, components); rep app uses inline C palette in DailySchedule.tsx
- AppLayout.tsx branches on role: admin → AdminChrome (sidebar) + admin pages, rep → header + /schedule fullscreen
- AdminVisits uses soft-delete (is_deleted = true); realtime subscription is INSERT + UPDATE only (no DELETE trigger)
- active_card_state in IndexedDB must be cleared on every checkout path (online PATCH, offline queue, and error/catch paths)
- expandedActiveIdRef realtime guard must always be preserved — never remove it
- schedule_template_items GROUP BY queries must always include weekly_template_id to avoid cross-week deletions
- client_generated_id is used for idempotent visit upsert at arrival — must be persisted to IndexedDB immediately and restored before checkout
- On checkout: resolve patchVisitId from state → IDB → client_generated_id DB lookup, in that order. Only INSERT if all three return null.
- Week self-heal runs on every fetchSchedule() call (isToday only) — compares get_week_order_for_date() to stored current_week_order and upserts correction silently
- Never pre-generate future daily_schedules — breaks week rotation on anchor change
- Off-route orders: excluded from strike rate and visit counts, included in order value totals
- In-progress visits: excluded from all admin queries, reports, and Done tab
- offlineDb.ts IDB operations re-throw as `IDB_ERROR: <message>` — call sites importing from offlineDb should catch this prefix to identify storage failures
- `offline_schedule_item_updates` uses schedule_item_id as keyPath intentionally — state snapshot pattern, last write before sync is authoritative. Do not redesign
- `adHocPhoto` in DailySchedule.tsx is `{ blob: Blob; preview: string } | null` — base64 conversion is lazy, only in offline/error fallback paths
- AdminSchedules uses master-detail layout: rep rail + week-cycle rail + day tabs + stops list with drag-to-reorder

## IndexedDB Stores (DB_VERSION: 5)
- offline_visits_queue — queued visit inserts (key: client_generated_id)
- offline_schedule_item_updates — queued schedule item updates (supports visitId for PATCH vs INSERT)
- cached_customers — bootstrapped customer list
- cached_schedules — bootstrapped schedules (-2 to +7 days)
- cached_user_auth — auth context for offline login
- pending_photos — failed photo uploads (key: scheduleItemId, fields: base64, visitId, clientGeneratedId)
- active_card_state — active card context (key: "current", fields: scheduleItemId, arrivalTime, notes, visitId, clientGeneratedId)
Increment DB_VERSION whenever adding or renaming a store.

## Excel / PDF Exports
- Excel: xlsx-js-style ONLY — never xlsx or exceljs (both confirmed broken)
- PDF: jspdf + jspdf-autotable, A4 landscape

## Coding Rules
- TypeScript only — no plain JS files
- No new npm packages without explicit instruction
- No new files unless explicitly instructed
- All refactoring stays in-file
- Never physically delete visits or customers — use is_deleted or is_active flags
- Camera must be triggered by user gesture only (iOS Safari requirement)
- All fixes must work on both iOS Safari and Android Chrome
- Prefer root-cause fixes — no symptom patches or workarounds
- DailySchedule.tsx is the highest-risk file in the codebase — avoid large refactors
