import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/700.css";
import "@/index.css";
import "@/core/i18n";
import { createRoot } from "react-dom/client";
import { Cards } from "./Cards";
import { connectHost } from "./host";

void connectHost().then((host) => createRoot(document.getElementById("root") as HTMLElement).render(<Cards host={host} />));
