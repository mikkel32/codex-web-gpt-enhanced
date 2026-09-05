import { useLayoutEffect, useState } from "react";
/** Native child views must remain out of the renderer's way while overlays leave. */
export function useOverlayPresence(active: boolean, duration: number) {
  const [leaving, setLeaving] = useState(active);
  useLayoutEffect(() => {
    if (active) { setLeaving(true); return; }
    const timer = setTimeout(() => setLeaving(false), duration);
    return () => clearTimeout(timer);
  }, [active, duration]);
  return active || leaving;
}
