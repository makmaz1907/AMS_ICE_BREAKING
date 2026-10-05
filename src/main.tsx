import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { HostPage } from "./pages/HostPage";
import { JoinPage } from "./pages/JoinPage";

const page = window.location.pathname === "/join" ? <JoinPage /> : <HostPage />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
