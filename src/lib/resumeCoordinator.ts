import { supabase } from "@/integrations/supabase/client";
import { syncVisitEvents } from "./syncEngine";

// ─── Resume coordinator ─────────────────────────────────────────────────────
//
// Single source of truth for "the app just came back into view." Replaces
// three independent visibilitychange listeners (useAuth session refresh,
// AppLayout's setupAutoSync, DailySchedule's force-refetch) with one
// coordinated sequence: check session -> drain sync queue -> notify.
//
// Subscribers should treat a resume notification as a cue to quietly
// reconcile their own data — never as a cue to show a spinner or blank UI.

type ResumeListener = () => void;

const listeners = new Set<ResumeListener>();
let wired = false;
let running = false;

async function runResumeSequence() {
  if (document.visibilityState !== "visible") return;
  if (running) return; // guard against overlapping runs on rapid visibility flips
  running = true;

  try {
    // 1. Confirm the session is still valid; refresh if not.
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        await supabase.auth.refreshSession();
      }
    } catch {
      // non-fatal — the auth state listener elsewhere handles a genuine sign-out
    }

    // 2. Drain the outbox if online. Idempotent + lock-guarded in syncEngine,
    // so this can safely overlap with the 'online' event trigger elsewhere.
    if (navigator.onLine) {
      try {
        await syncVisitEvents();
      } catch {
        // non-fatal — sync errors are tracked per-event in the outbox itself
      }
    }

    // 3. Notify subscribers. Each decides for itself whether a quiet
    // reconcile is needed — this coordinator never assumes.
    for (const listener of listeners) {
      try { listener(); } catch { /* one bad subscriber shouldn't break others */ }
    }
  } finally {
    running = false;
  }
}

export function onResume(listener: ResumeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function initResumeCoordinator(): () => void {
  if (wired) return () => {};
  wired = true;
  document.addEventListener("visibilitychange", runResumeSequence);
  return () => {
    document.removeEventListener("visibilitychange", runResumeSequence);
    wired = false;
  };
}
