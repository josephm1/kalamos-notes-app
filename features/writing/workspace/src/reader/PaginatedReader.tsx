import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Block } from "../markdown/parse";
import type { InlineInkRun } from "../ink/types";
import { BlockView } from "./BlockView";

type Props = {
  blocks: Block[];
  runsByBlock: Map<string, InlineInkRun[]>;
  selectedId: string | null;
  eink: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
};

/**
 * Pen-first paginated reader. The document is split into pages that fit the
 * viewport; the pen taps a section to select it and Prev/Next buttons turn
 * pages — no finger scrolling required. See owner decision (pen navigation).
 */
export function PaginatedReader({
  blocks,
  runsByBlock,
  selectedId,
  eink,
  onSelect,
  onOpen,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [pageStarts, setPageStarts] = useState<number[]>([0]);
  const [page, setPage] = useState(0);

  const recompute = useCallback(() => {
    const vp = viewportRef.current;
    const inner = innerRef.current;
    if (!vp || !inner) return;
    const vh = vp.clientHeight;
    const kids = Array.from(inner.children) as HTMLElement[];
    const starts = [0];
    let start = 0;
    for (const k of kids) {
      const top = k.offsetTop;
      const bottom = top + k.offsetHeight;
      if (bottom > start + vh) {
        if (top > start) {
          start = top;
          starts.push(start);
        } else {
          // Block taller than a page: it owns this page; next starts after it.
          start = bottom;
          starts.push(start);
        }
      }
    }
    setPageStarts(starts);
    setPage((p) => Math.min(p, starts.length - 1));
  }, []);

  useLayoutEffect(() => {
    recompute();
  }, [blocks, recompute]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(vp);
    return () => ro.disconnect();
  }, [recompute]);

  // Keep the selected block's page in view when selection changes.
  useEffect(() => {
    if (!selectedId || !innerRef.current) return;
    const el = innerRef.current.querySelector<HTMLElement>(
      `[data-block-id="${selectedId}"]`
    );
    if (!el) return;
    const top = el.offsetTop;
    let target = 0;
    for (let i = 0; i < pageStarts.length; i++) {
      if (pageStarts[i] <= top + 1) target = i;
    }
    setPage(target);
  }, [selectedId, pageStarts]);

  const pageCount = pageStarts.length;
  const canPrev = page > 0;
  const canNext = page < pageCount - 1;
  const goPrev = () => canPrev && setPage((p) => p - 1);
  const goNext = () => canNext && setPage((p) => p + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PageDown" || e.key === "ArrowRight") goNext();
      else if (e.key === "PageUp" || e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="reader-viewport" ref={viewportRef}>
        <div
          className="reader-page"
          ref={innerRef}
          style={{
            transform: `translateY(-${pageStarts[page] ?? 0}px)`,
            transition: eink ? "none" : undefined,
          }}
        >
          {blocks.map((block) => {
            if (block.type === "yaml") return null;
            return (
              <BlockView
                key={block.id}
                block={block}
                runs={runsByBlock.get(block.id) ?? []}
                selected={selectedId === block.id}
                onSelect={() => onSelect(block.id)}
                onOpen={() => onOpen(block.id)}
              />
            );
          })}
        </div>
      </div>

      {selectedId && (
        <div className="selected-actions" role="group" aria-label="Section actions">
          <button className="edit-section" onClick={() => onOpen(selectedId)}>
            ✎ Edit section
          </button>
        </div>
      )}

      <nav className="page-nav" aria-label="Pagination">
        <button onClick={goPrev} disabled={!canPrev} aria-label="Previous page">
          ◀ Prev
        </button>
        <span className="page-indicator" aria-live="polite">
          {Math.min(page + 1, pageCount)} / {pageCount}
        </span>
        <button onClick={goNext} disabled={!canNext} aria-label="Next page">
          Next ▶
        </button>
      </nav>
    </>
  );
}
