import type { LauncherSnapshot } from "./types";

/** A remembered version in an error/idle state is not an installable release. */
export function updatePresentation(snapshot: Pick<LauncherSnapshot, "update" | "browser" | "operation" | "profile">) {
  const { update } = snapshot;
  const candidate = ["available", "downloading", "installing"].includes(update.status)
    && "version" in update && typeof update.version === "string" && update.version.trim()
    ? update.version : null;
  const active = snapshot.operation?.status === "running"
    || snapshot.browser?.status === "running"
    || snapshot.browser?.tabs.some(tab => tab.status === "running" || tab.status === "testing") === true;
  return {
    candidate, active,
    canInstall: snapshot.profile !== "development" && update.status === "available" && candidate !== null && !active,
    busy: ["checking", "downloading", "installing"].includes(update.status),
  };
}
