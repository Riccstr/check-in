import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Register service worker — force update immediately, never leave in waiting state
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log("[SW] New content available, updating...");
    // Force the new SW to take over immediately
    updateSW(true);
  },
  onOfflineReady() {
    console.log("[SW] App ready for offline use");
  },
  onRegisteredSW(swUrl, registration) {
    console.log("[SW] Registered at:", swUrl);
    // Check for updates every 5 minutes
    if (registration) {
      setInterval(() => {
        registration.update();
      }, 5 * 60 * 1000);
    }
  },
});

createRoot(document.getElementById("root")!).render(<App />);
