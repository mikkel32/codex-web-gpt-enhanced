import { useEffect, useSyncExternalStore } from "react";
import { createConnectionMonitor } from "./connection-monitor";

const monitor = createConnectionMonitor(() => window.codexWebLauncher!.connectionStatus());
monitor.setVisible(!document.hidden);
let bindings = 0;
let detach = () => {};
export function useConnectionStatus() {
  const value = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getSnapshot);
  useEffect(() => {
    bindings += 1;
    if (bindings === 1) {
      const api = window.codexWebLauncher!;
      const visibility = () => monitor.setVisible(!document.hidden);
      let fingerprint = "";
      const offBrowser = api.onBrowserState(state => {
        const key = JSON.stringify([state.status, state.authenticated, state.webAccess?.status]);
        if (key !== fingerprint) { fingerprint = key; monitor.invalidate(); }
      });
      const offState = api.onStateChanged(() => monitor.invalidate());
      const offOperation = api.onOperation(operation => { if (operation.status !== "running") monitor.invalidate(); });
      document.addEventListener("visibilitychange", visibility);
      visibility();
      detach = () => { offBrowser(); offState(); offOperation(); document.removeEventListener("visibilitychange", visibility); };
    }
    return () => { bindings -= 1; if (!bindings) detach(); };
  }, []);
  return { ...value, refresh: monitor.refresh };
}
