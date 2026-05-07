import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanLoginGate } from "./components/lan/LanLoginGate";
import { MobileFolderPicker } from "./components/lan/MobileFolderPicker";
import { UpdateModal } from "./components/update/UpdateModal";
import { AboutModal } from "./components/about/AboutModal";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LanLoginGate>
      <App />
    </LanLoginGate>
    {/* 浏览器（LAN 客户端）模式下 bridge.pickFolder 会弹这个 modal；
        Tauri 桌面端走原生 dialog 不触发 modal，组件挂在这里仅占位。 */}
    <MobileFolderPicker />
    {/* 自动更新弹窗：Tauri 桌面端启动后后台 check + 用户从「关于」手动 check 都在这里渲染 */}
    <UpdateModal />
    {/* 关于：项目简介 + 当前版本 + 检查更新入口 */}
    <AboutModal />
  </React.StrictMode>,
);
