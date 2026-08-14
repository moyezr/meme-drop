import "@fontsource/anton/latin-400.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-900.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
