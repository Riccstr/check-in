import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Register service worker with immediate update for iOS compatibility
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);
