import React from "react";
import { createRoot } from "react-dom/client";
import { OperationsSyncEntry, SyncCenterWorkbench } from "../../src/components/operations/sync-center-workbench";
createRoot(document.getElementById("root")!).render(new URLSearchParams(window.location.search).get("entry") ? <OperationsSyncEntry /> : <SyncCenterWorkbench />);
