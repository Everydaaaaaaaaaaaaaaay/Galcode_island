import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanLoginGate } from "./components/lan/LanLoginGate";
import { MobileFolderPicker } from "./components/lan/MobileFolderPicker";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanLoginGate>
      <App />
    </LanLoginGate>
    {/* 浏览器（LAN 客户端）模式下 bridge.pickFolder 会弹这个 modal；
        Tauri 桌面端走原生 dialog 不触发 modal，组件挂在这里仅占位。 */}
    <MobileFolderPicker />
  </React.StrictMode>,
);
