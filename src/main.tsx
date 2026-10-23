import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Menu from "@/menu/Menu";
import Overlay from "@/overlay/Overlay";
import RemoteCat from "@/overlay/RemoteCat";
import "./index.css";

// One bundle for all windows: "menu" gets the menu, "cat-<steamid>" another player's cat, "main" our cat.
const label = getCurrentWindow().label;
const Root = label === "menu" ? Menu : label.startsWith("cat-") ? RemoteCat : Overlay;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
