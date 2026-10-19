import { useEffect, useRef, useState } from "react";

export type SaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "offline"
  | "conflict"
  | "error"
  | "ink-local";

type Props = {
  filename: string | null;
  status: SaveStatus;
  onOpen: () => void;
  onOverflow: () => void;
};

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline",
  conflict: "File changed on disk",
  error: "Save failed",
  "ink-local": "Ink saved in this app",
};

/**
 * Compact top bar (~44px) that collapses while scrolling down and returns when
 * scrolling up. Status text is transient — only shown when it matters. (§5.1.)
 */
export function TopBar({ filename, status, onOpen, onOverflow }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const lastScroll = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastScroll.current + 8 && y > 56) setCollapsed(true);
      else if (y < lastScroll.current - 8) setCollapsed(false);
      lastScroll.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const showStatus = status !== "idle";

  return (
    <header className={`top-bar${collapsed ? " collapsed" : ""}`}>
      <button className="icon-btn" onClick={onOpen} aria-label="Open file / files">
        ☰
      </button>
      <span className="filename" title={filename ?? ""}>
        {filename ?? "Kalamos Write"}
      </span>
      <span
        className={`save-status status-${status}`}
        role="status"
        aria-live="polite"
      >
        {showStatus ? STATUS_LABEL[status] : ""}
      </span>
      <button className="icon-btn" onClick={onOverflow} aria-label="More actions">
        ⋯
      </button>
    </header>
  );
}
