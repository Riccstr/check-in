import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Register service worker for offline app shell support
registerSW({
  immediate: true,
  onOfflineReady() {
    console.log("[SW] App ready for offline use");
  },
  onRegisteredSW(swUrl, registration) {
    console.log("[SW] Registered at:", swUrl);
    if (registration) {
      // Keep the app shell fresh without forcing hard reload loops
      setInterval(() => {
        registration.update();
      }, 5 * 60 * 1000);
    }
  },
});

// ---------------------------------------------------------------------------
// Mobile background-restore recovery
//
// Both iOS Safari and some Android browsers can discard a backgrounded page
// from memory.  When the user foregrounds the app the browser either:
//   (a) restores it from the back/forward cache (bfcache) — page looks intact
//       but JS state may be stale or the React root may be empty, or
//   (b) reloads the page — handled normally by the service worker.
//
// The two listeners below are a safety net that forces a clean reload when
// the page is restored blank or from bfcache.
// ---------------------------------------------------------------------------

/**
 * Fires whenever the tab/PWA becomes visible again (e.g. user switches back
 * from another app).  If the React root has no children the page rendered
 * blank — force a reload to recover.
 */
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    const root = document.getElementById("root");
    if (root && root.children.length === 0) {
      console.log("[App] Blank root detected on visibility restore — reloading");
      window.location.reload();
    }
  }
});

/**
 * Fires when iOS (or any browser) restores a page from the bfcache.
 * event.persisted === true means the page was NOT re-fetched — it was pulled
 * from memory.  Force a reload so the app always re-initialises cleanly.
 */
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    console.log("[App] Restored from bfcache — reloading");
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
