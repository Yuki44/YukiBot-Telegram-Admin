import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { applyTheme, readInitialTheme } from "./lib/theme";
import "./styles/yukibot.css";

// Apply theme before first paint to avoid a light flash on dark-mode users.
applyTheme(readInitialTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
