import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Menu from "@/menu/Menu";
import Overlay from "@/overlay/Overlay";
import "./index.css";

// One bundle for both windows: the "menu" window gets the menu, "main" the cat overlay.
const Root = getCurrentWindow().label === "menu" ? Menu : Overlay;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
