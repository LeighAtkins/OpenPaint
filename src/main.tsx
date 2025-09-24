import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
function App(){ return <div style={{padding:16,fontFamily:"system-ui"}}>TS + Bun + React alive ✅</div>; }
createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);
