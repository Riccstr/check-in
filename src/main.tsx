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

createRoot(document.getElementById("root")!).render(<App />);
