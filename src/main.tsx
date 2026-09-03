import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./ui/app.css";
import { useStore } from "./app/store";

if (import.meta.env.DEV) (window as any).__store = useStore;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
