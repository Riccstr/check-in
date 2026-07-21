import { openDB, type IDBPDatabase } from "idb";
import type { VisitEvent } from "./visitOutbox";

const DB_NAME = "checkin-tracker-offline";
const DB_VERSION = 7;

// ─── Store inventory (v7) ───────────────────────────────────────────────────
//
// Operational (new model):
//   active_visit   key "current"  — the ONE in-progress visit (scheduled or ad-hoc).
//                                    Device-owned truth while a visit is open.
//   visit_outbox   keyPath eventId — append-only queue of VisitEvents.
//   offroute_draft key "current"  — off-route order draft (can coexist with an
//                                    open visit; no arrival/photo).
//
// Caches (preserved):
//   cached_customers, cached_user_auth, cached_schedules
//
// Removed in v7 (old model — deleted on upgrade):
//   offline_visits_queue, offline_schedule_item_updates,
//   active_card_state, active_adhoc_state, active_offroute_state, pending_photos

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // ── New operational stores ──
        if (!db.objectStoreNames.contains("active_visit")) {
          db.createObjectStore("active_visit", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("visit_outbox")) {
          db.createObjectStore("visit_outbox", { keyPath: "eventId" });
        }
        if (!db.objectStoreNames.contains("offroute_draft")) {
          db.createObjectStore("offroute_draft", { keyPath: "key" });
        }

        // ── Preserved caches (create if a fresh install lands straight on v7) ──
        if (!db.objectStoreNames.contains("cached_customers")) {
          db.createObjectStore("cached_customers", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("cached_user_auth")) {
          db.createObjectStore("cached_user_auth", { keyPath: "user_id" });
        }
        if (!db.objectStoreNames.contains("cached_schedules")) {
          db.createObjectStore("cached_schedules", { keyPath: "key" });
        }

        // ── Clean break: remove obsolete stores from the old model ──
        for (const name of [
          "offline_visits_queue",
          "offline_schedule_item_updates",
          "active_card_state",
          "active_adhoc_state",
          "active_offroute_state",
          "pending_photos",
        ]) {
          if (db.objectStoreNames.contains(name)) {
            db.deleteObjectStore(name);
          }
        }

        // ── Clear the schedule cache so no old-shaped items survive into the
        //    new machine. Customer + auth caches are intentionally preserved.
        //    (Only when upgrading from an existing DB, not a fresh install.)
        if (oldVersion > 0 && db.objectStoreNames.contains("cached_schedules")) {
          tx.objectStore("cached_schedules").clear();
        }
      },
    });
  }
  return dbPromise;
}

// ═══════════════════════════════════════════════════════════════════════════
// Active visit — the single in-progress visit (scheduled or ad-hoc)
// ═══════════════════════════════════════════════════════════════════════════

export interface ActiveVisit {
  clientId: string;
  // Origin: a scheduled stop carries its schedule_item id + customer; an ad-hoc
  // visit carries only the customer. scheduleItemId is re-resolved on load by
  // (customerId, visitDate) so a schedule regeneration can't orphan it.
  kind: "scheduled" | "adhoc";
  scheduleItemId: string | null;
  repId: string;
  customerId: string;
  customerName: string | null;
  visitDate: string;
  arrivalTime: string;
  notes: string;
  orderNumber: string;
  orderQty: string;
  orderAmount: string;
  // Photo held as base64 (data URL). Single source — no separate photo store.
  photoBase64: string | null;
  updatedAt: string;
}

export async function saveActiveVisit(data: ActiveVisit): Promise<void> {
  try {
    const db = await getDb();
    await db.put("active_visit", { key: "current", ...data });
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getActiveVisit(): Promise<ActiveVisit | null> {
  try {
    const db = await getDb();
    const entry = await db.get("active_visit", "current");
    if (!entry) return null;
    const { key, ...rest } = entry as any;
    return rest as ActiveVisit;
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function clearActiveVisit(): Promise<void> {
  try {
    const db = await getDb();
    await db.delete("active_visit", "current");
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Visit outbox — append-only event queue
// ═══════════════════════════════════════════════════════════════════════════

export async function enqueueVisitEvent(event: VisitEvent): Promise<void> {
  try {
    const db = await getDb();
    await db.put("visit_outbox", event);
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getAllVisitEvents(): Promise<VisitEvent[]> {
  try {
    const db = await getDb();
    return (await db.getAll("visit_outbox")) as VisitEvent[];
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getPendingVisitEvents(): Promise<VisitEvent[]> {
  try {
    const all = await getAllVisitEvents();
    return all.filter((e) => e.syncStatus === "pending" || e.syncStatus === "error");
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function updateVisitEventStatus(
  eventId: string,
  status: "synced" | "error",
  errorMessage?: string
): Promise<void> {
  try {
    const db = await getDb();
    const event = (await db.get("visit_outbox", eventId)) as VisitEvent | undefined;
    if (event) {
      event.syncStatus = status;
      event.lastSyncAttempt = new Date().toISOString();
      event.errorMessage = errorMessage ?? null;
      await db.put("visit_outbox", event);
    }
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function removeSyncedVisitEvents(): Promise<number> {
  try {
    const db = await getDb();
    const tx = db.transaction("visit_outbox", "readwrite");
    const all = (await tx.store.getAll()) as VisitEvent[];
    const synced = all.filter((e) => e.syncStatus === "synced");
    for (const e of synced) await tx.store.delete(e.eventId);
    await tx.done;
    return synced.length;
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Does the outbox hold any event for this clientId? Used by reconciliation to
// tell "this visit already emitted events" from "never started".
export async function hasEventsForClient(clientId: string): Promise<boolean> {
  try {
    const all = await getAllVisitEvents();
    return all.some((e) => e.clientId === clientId);
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Off-route draft — survives backgrounding; independent of active_visit
// ═══════════════════════════════════════════════════════════════════════════

export interface OffRouteDraft {
  customerId: string;
  orderNumber: string;
  orderQty: string;
  orderAmount: string;
  notes: string;
}

export async function saveOffRouteDraft(data: OffRouteDraft): Promise<void> {
  try {
    const db = await getDb();
    await db.put("offroute_draft", { key: "current", ...data });
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getOffRouteDraft(): Promise<OffRouteDraft | null> {
  try {
    const db = await getDb();
    const entry = await db.get("offroute_draft", "current");
    if (!entry) return null;
    const { key, ...rest } = entry as any;
    return rest as OffRouteDraft;
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function clearOffRouteDraft(): Promise<void> {
  try {
    const db = await getDb();
    await db.delete("offroute_draft", "current");
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cached customers (preserved)
// ═══════════════════════════════════════════════════════════════════════════

export interface CachedCustomer {
  id: string;
  customer_name: string;
  account_number?: string | null;
  area?: string | null;
}

export async function setCachedCustomers(customers: CachedCustomer[]): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction("cached_customers", "readwrite");
    await tx.store.clear();
    for (const c of customers) await tx.store.put(c);
    await tx.done;
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getCachedCustomers(): Promise<CachedCustomer[]> {
  try {
    const db = await getDb();
    return db.getAll("cached_customers");
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cached user auth (preserved)
// ═══════════════════════════════════════════════════════════════════════════

export interface CachedUserProfile {
  id: string;
  full_name: string | null;
  created_at: string;
  login_updated_at?: string | null;
  login_updated_by?: string | null;
}

export interface CachedUserAuth {
  user_id: string;
  role: "admin" | "rep" | null;
  rep_id: string | null;
  rep_name: string | null;
  profile: CachedUserProfile | null;
  permissions: string[];
  cached_at: string;
}

export async function setCachedUserAuth(auth: CachedUserAuth): Promise<void> {
  try {
    const db = await getDb();
    await db.put("cached_user_auth", auth);
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getCachedUserAuth(userId: string): Promise<CachedUserAuth | null> {
  try {
    const db = await getDb();
    const cached = (await db.get("cached_user_auth", userId)) as CachedUserAuth | null;
    if (!cached) return null;
    return {
      ...cached,
      profile: cached.profile ?? null,
      permissions: Array.isArray(cached.permissions) ? cached.permissions : [],
    };
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function clearCachedUserAuth(userId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete("cached_user_auth", userId);
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cached schedules (preserved; cleared once on v7 upgrade)
// ═══════════════════════════════════════════════════════════════════════════

export async function setCachedSchedule(repId: string, date: string, data: any): Promise<void> {
  try {
    const db = await getDb();
    await db.put("cached_schedules", {
      key: `${repId}_${date}`,
      rep_id: repId,
      schedule_date: date,
      schedule_id: data?.id || null,
      data,
      cached_at: new Date().toISOString(),
    });
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getCachedSchedule(repId: string, date: string): Promise<any | null> {
  try {
    const db = await getDb();
    const cached = await db.get("cached_schedules", `${repId}_${date}`);
    return cached?.data || null;
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function updateCachedScheduleItem(
  repId: string,
  date: string,
  itemId: string,
  updates: Record<string, any>
): Promise<void> {
  try {
    const db = await getDb();
    const key = `${repId}_${date}`;
    const tx = db.transaction("cached_schedules", "readwrite");
    const cached = await tx.store.get(key);
    if (!cached?.data?.schedule_items || !Array.isArray(cached.data.schedule_items)) {
      await tx.done;
      return;
    }
    cached.data.schedule_items = cached.data.schedule_items.map((item: any) =>
      item.id === itemId ? { ...item, ...updates } : item
    );
    cached.cached_at = new Date().toISOString();
    await tx.store.put(cached);
    await tx.done;
  } catch (err) {
    throw new Error(`IDB_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}