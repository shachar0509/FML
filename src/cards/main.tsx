import "@/index.css";
import "./cards.css";
import "@/core/i18n";
import { createRoot } from "react-dom/client";
import { Cards } from "./Cards";
import { connectHost } from "./host";

void connectHost().then((host) => createRoot(document.getElementById("root") as HTMLElement).render(<Cards host={host} />));
