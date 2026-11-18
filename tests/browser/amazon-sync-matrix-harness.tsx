import React from "react";
import { createRoot } from "react-dom/client";
import { AmazonSyncMatrix } from "../../src/components/operations/amazon-sync-matrix";
import { AmazonConnections } from "../../src/components/settings/amazon-connections";

const params = new URLSearchParams(window.location.search);
const root = createRoot(document.getElementById("root")!);
root.render(params.get("conn") === "1" ? <AmazonConnections /> : <AmazonSyncMatrix initialTab={params.get("tab") === "ads" ? "ads" : "sp"} />);
