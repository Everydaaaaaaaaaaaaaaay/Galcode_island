import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanLoginGate } from "./components/lan/LanLoginGate";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanLoginGate>
      <App />
    </LanLoginGate>
  </React.StrictMode>,
);
