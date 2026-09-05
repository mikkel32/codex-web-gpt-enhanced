import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import type { LauncherApi, LauncherState } from "./types";

const QUERY = "(max-width: 820px)";
const clamp = (width: number) => Math.round(Math.max(240, Math.min(420, width)));
export function useSidebar(api: LauncherApi, initial: LauncherState, report: (error: unknown) => void) {
  const [compact, setCompact] = useState(() => window.matchMedia(QUERY).matches);
  const [desktopOpen, setDesktopOpen] = useState(initial.sidebarOpen);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [width, setWidth] = useState(clamp(initial.sidebarWidth || 252));
  const [resizing, setResizing] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const openRef = useRef(desktopOpen), widthRef = useRef(width), compactRef = useRef(compact);
  const reportRef = useRef(report); reportRef.current = report;
  const pending = useRef<{ open: boolean; width: number } | null>(null);
  const writing = useRef(false);
  const drag = useRef<{ start: number; width: number } | null>(null);
  const save = useCallback(async () => {
    pending.current = { open: openRef.current, width: widthRef.current };
    if (writing.current) return;
    writing.current = true;
    try {
      while (pending.current) {
        const next = pending.current; pending.current = null;
        try { await api.setSidebarState(next); } catch (error) { reportRef.current(error); }
      }
    } finally { writing.current = false; }
  }, [api]);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    let settle: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(settle);
      setSwitchingMode(true);
      compactRef.current = media.matches; setCompact(media.matches); setOverlayOpen(false);
      settle = setTimeout(() => setSwitchingMode(false), 100);
    };
    media.addEventListener("change", changed);
    return () => { clearTimeout(settle); media.removeEventListener("change", changed); };
  }, []);
  const toggle = useCallback(() => {
    if (compactRef.current) { setOverlayOpen(value => !value); return; }
    openRef.current = !openRef.current;
    setDesktopOpen(openRef.current);
    void save();
  }, [save]);
  const changeWidth = (next: number) => { widthRef.current = clamp(next); setWidth(widthRef.current); };
  const resetWidth = () => { changeWidth(252); void save(); };
  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null; setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    void save();
  };
  return {
    compact, open: compact ? overlayOpen : desktopOpen, rail: !compact && !desktopOpen,
    width, resizing, switchingMode, toggle, closeOverlay: () => setOverlayOpen(false),
    resizeProps: {
      onDoubleClick: resetWidth,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || compactRef.current) return;
        event.preventDefault(); event.currentTarget.focus();
        drag.current = { start: event.clientX, width: widthRef.current }; setResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => { if (drag.current) changeWidth(drag.current.width + event.clientX - drag.current.start); },
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
        event.preventDefault();
        changeWidth(event.key === "Home" ? 240 : event.key === "End" ? 420 : event.key === "Enter" ? 252
          : widthRef.current + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 32 : 16));
        void save();
      },
    },
  };
}
