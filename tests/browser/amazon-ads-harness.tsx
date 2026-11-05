import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AdsWorkspace } from "@/components/amazon-ads/ads-workspace";
function Harness() {
  const [path, setPath] = useState(location.pathname);
  return <><aside style={{ position: "fixed", left: 0, width: 76, top: 0, bottom: 0, background: "white", borderRight: "1px solid #ddd", textAlign: "center", paddingTop: 20 }}>ERP</aside><header style={{ position: "sticky", top: 0, marginLeft: 76, height: 64, zIndex: 50, background: "white", padding: 20, borderBottom: "1px solid #ddd" }}>Amazon Ads · ERP 现有布局</header><div style={{ marginLeft: 76, padding: 24 }}><AdsWorkspace path={path} navigate={value => { history.pushState({}, "", value); setPath(value); }} /></div></>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
