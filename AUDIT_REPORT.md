# Check-In Tracker — Audit Report

**Audit Date:** 2026-06-29  
**Scope:** 23 core files across pages, components, hooks, and lib  
**Note:** Read-only analysis; no changes applied  

---

## Critical (data loss / corruption risk)

| # | File | Line(s) | Description |
|---|------|---------|-------------|
| 1 | `src/components/schedule/AdHocVisitCard.tsx` | 127–130 | **Submission guard not reset on validation failure:** `submittingRef.current = true` is set at line 127, but if duration validation fails at line 130 (`if (dur <= 0)`), the function returns early without resetting the ref. This leaves the submit button permanently disabled until page reload. The finally block at line 235 never executes, trapping the button in a disabled state. |
| 2 | `src/components/schedule/OffRouteOrderCard.tsx` | 83–85 | **Submission guard not reset on validation failure:** Same pattern as AdHocVisitCard—`submittingRef.current = true` is set at line 83, but if the order validation fails at line 85 (`if (!hasOrder)`), the function returns early without resetting the ref, leaving the button permanently disabled. |
| 3 | `src/pages/admin/AdminVisits.tsx` | 183 | **Unsafe locale-dependent parsing of user input:** `order_amount: editOrderAmount !== "" ? Number(editOrderAmount) : null` uses `Number()` instead of `parseAmount()`. This will fail to parse South African comma-formatted amounts (e.g., "1,50" becomes NaN). Affects admin edit modal for visit order amounts. |

---

## High (broken functionality / wrong behaviour)

| # | File | Line(s) | Description |
|---|------|---------|-------------|
| 1 | `src/pages/admin/AdminVisits.tsx` | 87, 162–166 | **Conflicting delete strategies in same file:** Line 87 filters queries with `is_deleted = false` (soft delete assumption), but the `del()` function at lines 162–166 performs hard delete via `.delete()`. AdminDashboard, AdminExports, and CustomerDashboard also query with `is_deleted = false`, assuming soft deletes. This mismatch means hard-deleted visits are removed from one interface but still expected by others' logic. Data inconsistency risk. |
| 2 | `src/pages/DailySchedule.tsx` | 385, 407 | **`repairMissingVisitIds()` may reference wrong items after navigation:** The function is called with `sortedItems` or `sortedNewItems` directly, but it's possible for items to change between the fetch and the repair call in async flow. The function internally calls `fetchUnscheduledVisits()` at line 481, which uses a stale `scheduleDate` from closure if the date changed during the repair. This can cause unscheduled visits to be fetched for the wrong date. |
| 3 | `src/components/schedule/ScheduleCard.tsx` | 111–183 | **`activeVisitId` and `clientGenIdRef` restored unconditionally on mount but may conflict with race conditions:** Lines 111–183 restore active card state from IDB without checking if a newer arrival has already occurred online. If the network response for a previous visit arrives after remount and restoration, it could overwrite the card state with stale data. |

---

## Medium (edge case failures / poor UX)

| # | File | Line(s) | Description |
|---|------|---------|-------------|
| 1 | `src/pages/admin/AdminVisits.tsx` | 171–173 | **Naive time parsing without error handling:** `const [ah, am] = editArrival.split(":").map(Number);` will silently fail if editArrival is malformed (e.g., "12" with no colon). Split produces `["12"]`, map produces `[12, NaN]`, and subsequent math produces `NaN` for duration, which bypasses the duration validation at line 174. Invalid data could be saved. |
| 2 | `src/hooks/useAuth.tsx` | 159 | **Safety timeout forces loading to false without auth resolution:** Line 159 has a hardcoded 10-second timeout that unconditionally sets `loading = false` even if auth context wasn't resolved. Subsequent calls to `useAuth()` return `repId = null` and `role = null`, causing route guards to fail silently instead of retrying. Rep or admin login may appear to fail without clear feedback. |
| 3 | `src/lib/offlineDb.ts` | 110–119, 183–192, 247–271 | **IDB operations have no timeout or retry logic:** All IDB read/write operations assume completion. On a slow device or if the browser's IndexedDB quota is exceeded, operations hang indefinitely or throw unhandled errors. No exponential backoff or timeout for failed IDB access means offline state could desynchronize permanently. |
| 4 | `src/components/schedule/AdHocVisitCard.tsx` | 54, 131, 236 | **`adHocSubmitting` state and `submittingRef` can diverge:** `setAdHocSubmitting()` is called at line 131 and reset at line 236, but submitting validation uses only the ref. If `setAdHocSubmitting()` is slow or batched by React, the button may show "Checking out…" while the ref guard has already been released, allowing double-taps. |
| 5 | `src/pages/DailySchedule.tsx` | 287–302 | **`resolveUnknownCustomers()` silently ignores errors and leaves invalid state:** If the network fetch at line 293 fails, the items with missing customer names are never resolved. The catch block at line 299 silently ignores the error with a comment, leaving corrupted schedule items with null customer names in state. Rep sees "Unknown Customer" forever. |
| 6 | `src/components/schedule/EodSummaryModal.tsx` | (entire file) | **No validation of summary data before display:** Modal accepts `summaryStats` from parent with no null checks or fallbacks for individual fields. If `totalOrderValue` is undefined or `orders` is null, rendering could break or show incorrect values. No error boundary. |

---

## Low (code quality / minor polish)

| # | File | Line(s) | Description |
|---|------|---------|-------------|
| 1 | `src/lib/syncEngine.ts` | 52–54 | **Patch operation on visit ignores errors:** `await supabase.from("visits").update({...}).eq("id", update.visitId)` at line 51 never checks the error result. If the PATCH fails, the visit row is left with incomplete checkout data (leaving_time, duration, etc. missing) without logging or retry. Silent data corruption. |
| 2 | `src/components/schedule/ScheduleCard.tsx` | 256 | **Camera cooldown uses setTimeout instead of cleanup:** `setTimeout(() => { cameraCooldownRef.current = false; }, 200)` at line 256 does not have a corresponding cleanup in useEffect. If the component unmounts during the timeout, the ref reset fires after unmount, which is harmless but indicates loose async hygiene. |
| 3 | `src/pages/DailySchedule.tsx` | 244, 299, 339 | **Silent error handling in multiple async functions:** Empty catch blocks with comments like `/* offline - ignore */` and `/* silently ignore */` hide potential issues. Errors like quota exceeded, corrupted IDB, or unexpected Supabase errors are swallowed without logging, making debugging hard. |
| 4 | `src/lib/adminUi.tsx` | (entire file) | **Admin design system has no error state variants:** Buttons, selects, and form fields lack disabled/error styling. An admin saving an invalid edit may see no visual feedback that the action failed, leading to UX confusion. |
| 5 | `src/pages/admin/AdminSchedules.tsx` | 148 | **Console.warn indicates unresolved week calculation:** `console.warn("[Schedules] Failed to auto-calculate current week:", err)` suggests a known failure case that can occur but is never surfaced to the admin. Silent fallback leaves week name unset. |
| 6 | `src/components/schedule/ScheduleCard.tsx` | 89–91 | **Local state tied to item prop without deep equality check:** `useEffect(() => setLocalNotes(item.notes || ""); }, [item.notes])` only depends on `item.notes` scalar. If `item` object reference changes but `.notes` value is the same, the effect doesn't fire. If another property of `item` changes (e.g., `arrival_time`), a new effect re-renders and may wipe unsaved edits. |

---

## TODOs / FIXMEs found

| File | Line | Comment |
|------|------|---------|
| `src/pages/admin/AdminAccount.tsx` | 120 | `/* TODO the surface and TODO the handlers. */` — Placeholder comment about unfinished MFA enrollment UI. |
| `src/pages/admin/AdminAccount.tsx` | 131 | `/* TODO: hook up via supabase.auth.mfa.listFactors + .enroll */` — 2FA enrolment flow not implemented; button shows toast "2FA enrolment is not enabled yet." |

---

## Summary by Category

### Race Conditions & Async Bugs
- **2 critical**: Submission guards not reset on early returns (AdHocVisitCard, OffRouteOrderCard)
- **1 high**: `repairMissingVisitIds()` can reference stale closure variables
- **Multiple medium**: Time parsing without error handling, IDB operations without timeouts, diverging state between ref and `useState`

### Offline / IDB Issues
- **1 medium**: No timeout or retry logic for IDB operations, can hang indefinitely
- **Multiple low**: Silent error handling hides quota exceeded or corruption issues

### UI / UX Bugs
- **1 high**: Conflicting soft/hard delete strategies across admin pages
- **Multiple medium**: Missing error feedback in modals, no error state styling in admin forms

### Data Integrity
- **1 critical**: Unsafe `Number()` parsing of user-entered order amounts (AdminVisits edit modal)
- **1 medium**: Visit PATCH errors ignored in sync engine, leaving checkout data incomplete

### TypeScript / Type Safety
- No critical type safety issues found. `any` types are used but generally in safe contexts (dynamic Supabase responses).

### Admin Pages
- Conflicting delete strategy assumptions across AdminVisits, AdminDashboard, AdminExports, CustomerDashboard
- Weak error states and silent failures in edit modals
- Week calculation failures logged but not surfaced to admin

### General Code Quality
- 10+ `console.warn()` calls indicating silent failures
- Empty catch blocks swallow errors without logging
- 2 unfinished TODOs (2FA enrollment)

---

## Recommendations (Priority Order)

1. **Fix submission guard resets** (AdHocVisitCard, OffRouteOrderCard) — prevents button lockup
2. **Unify delete strategy** (soft vs. hard) — choose one across all admin pages and rep app
3. **Fix AdminVisits order_amount parsing** — replace `Number()` with `parseAmount()`
4. **Add timeout/retry to IDB operations** — prevent indefinite hangs on slow devices
5. **Validate summary stats before render** — add null checks in EodSummaryModal
6. **Surface silent errors** — log all catch blocks or show user feedback

---

**End of Report**
