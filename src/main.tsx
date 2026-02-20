import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Register service worker — force update immediately, never leave in waiting state
registerSW({
  immediate: true,
  onNeedRefresh() {
    // Auto-apply updates without prompting
    window.location.reload();
  },
  onOfflineReady() {
    console.log("App ready for offline use");
  },
});

createRoot(document.getElementById("root")!).render(<App />);
