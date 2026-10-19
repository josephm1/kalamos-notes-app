import { useEffect, useRef, useState } from "react";

type Info = {
  pointerType: string;
  pressure: number;
  buttons: number;
  tiltX: number;
  tiltY: number;
  coalesced: number;
  rate: number;
};

/**
 * Developer input panel showing detected pointer characteristics (Phase 0).
 * Hidden in production builds. Helps validate pen behaviour on real Android.
 */
export function InputDiagnostics() {
  const [info, setInfo] = useState<Info | null>(null);
  const lastT = useRef(0);
  const rate = useRef(0);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      const dt = now - lastT.current;
      if (dt > 0) rate.current = Math.round(1000 / dt);
      lastT.current = now;
      const coalesced =
        typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents().length : 0;
      setInfo({
        pointerType: e.pointerType,
        pressure: Number(e.pressure.toFixed(2)),
        buttons: e.buttons,
        tiltX: e.tiltX,
        tiltY: e.tiltY,
        coalesced,
        rate: rate.current,
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="input-diagnostics" aria-hidden="true">
      <strong>input</strong>
      {info ? (
        <>
          <span>type: {info.pointerType}</span>
          <span>press: {info.pressure}</span>
          <span>btn: {info.buttons}</span>
          <span>
            tilt: {info.tiltX},{info.tiltY}
          </span>
          <span>coalesced: {info.coalesced}</span>
          <span>~{info.rate}/s</span>
        </>
      ) : (
        <span>move a pointer…</span>
      )}
    </div>
  );
}
