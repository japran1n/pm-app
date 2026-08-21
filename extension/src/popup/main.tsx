import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Popup } from "./Popup";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Popup root element not found");
}

createRoot(container).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
