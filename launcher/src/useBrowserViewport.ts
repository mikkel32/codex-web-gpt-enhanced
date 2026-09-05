import { useLayoutEffect, useRef } from "react";
import { createViewportCoordinator } from "./viewport-coordinator";
import type { LauncherApi } from "./types";

export function useBrowserViewport(api: LauncherApi, slot: HTMLDivElement | null, active: boolean, onError: (error: unknown) => void) {
  const report = useRef(onError);
  report.current = onError;
  const owner = useRef<ReturnType<typeof createViewportCoordinator> | null>(null);
  if (!owner.current) owner.current = createViewportCoordinator(api, error => report.current(error));
  useLayoutEffect(() => {
    const coordinator = owner.current!;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = slot?.getBoundingClientRect();
        coordinator.update(active, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null);
      });
    };
    if (!active || !slot) coordinator.update(false);
    else measure();
    const observer = new ResizeObserver(measure);
    if (slot) observer.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      coordinator.update(false);
    };
  }, [api, slot, active]);
}
