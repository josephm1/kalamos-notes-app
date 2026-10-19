// Vanilla port of src/reader/PaginatedReader.tsx. Pen-first paginated reader:
// the pen taps a section to select it and Prev/Next buttons turn pages.

import type { Block } from "../markdown/parse";
import type { InlineInkRun } from "../ink/types";
import { renderBlock } from "./blockView";

export type PaginatedReaderProps = {
  blocks: Block[];
  runsByBlock: Map<string, InlineInkRun[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
};

export class PaginatedReader {
  private viewport: HTMLElement;
  private page: HTMLElement;
  private nav: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private indicator: HTMLElement;
  private selectedActions: HTMLElement;
  private editBtn: HTMLButtonElement;
  private ro: ResizeObserver;
  private pageStarts = [0];
  private pageIndex = 0;
  private props: PaginatedReaderProps;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "PageDown" || e.key === "ArrowRight") this.goNext();
    else if (e.key === "PageUp" || e.key === "ArrowLeft") this.goPrev();
  };

  constructor(root: HTMLElement, props: PaginatedReaderProps) {
    this.props = props;

    this.viewport = document.createElement("div");
    this.viewport.className = "reader-viewport";
    this.page = document.createElement("div");
    this.page.className = "reader-page";
    this.viewport.appendChild(this.page);

    this.selectedActions = document.createElement("div");
    this.selectedActions.className = "selected-actions";
    this.selectedActions.setAttribute("role", "group");
    this.selectedActions.setAttribute("aria-label", "Section actions");
    this.editBtn = document.createElement("button");
    this.editBtn.className = "edit-section";
    this.editBtn.textContent = "✎ Edit section";
    this.editBtn.addEventListener("click", () => {
      if (this.props.selectedId) this.props.onOpen(this.props.selectedId);
    });
    this.selectedActions.appendChild(this.editBtn);

    this.nav = document.createElement("nav");
    this.nav.className = "page-nav";
    this.nav.setAttribute("aria-label", "Pagination");
    this.prevBtn = document.createElement("button");
    this.prevBtn.textContent = "◀ Prev";
    this.prevBtn.setAttribute("aria-label", "Previous page");
    this.prevBtn.addEventListener("click", () => this.goPrev());
    this.indicator = document.createElement("span");
    this.indicator.className = "page-indicator";
    this.indicator.setAttribute("aria-live", "polite");
    this.nextBtn = document.createElement("button");
    this.nextBtn.textContent = "Next ▶";
    this.nextBtn.setAttribute("aria-label", "Next page");
    this.nextBtn.addEventListener("click", () => this.goNext());
    this.nav.append(this.prevBtn, this.indicator, this.nextBtn);

    root.append(this.viewport, this.selectedActions, this.nav);

    this.ro = new ResizeObserver(() => this.recompute());
    this.ro.observe(this.viewport);
    window.addEventListener("keydown", this.onKey);

    this.update(props);
  }

  private recompute() {
    const vh = this.viewport.clientHeight;
    const kids = Array.from(this.page.children) as HTMLElement[];
    const starts = [0];
    let start = 0;
    for (const k of kids) {
      const top = k.offsetTop;
      const bottom = top + k.offsetHeight;
      if (bottom > start + vh) {
        if (top > start) {
          start = top;
        } else {
          start = bottom;
        }
        starts.push(start);
      }
    }
    this.pageStarts = starts;
    this.pageIndex = Math.min(this.pageIndex, starts.length - 1);
    this.render();
  }

  /** Page turn for hardware page keys / external callers. */
  pageBy(dir: -1 | 1) {
    if (dir < 0) this.goPrev();
    else this.goNext();
  }

  private goPrev() {
    if (this.pageIndex > 0) {
      this.pageIndex -= 1;
      this.render();
    }
  }

  private goNext() {
    if (this.pageIndex < this.pageStarts.length - 1) {
      this.pageIndex += 1;
      this.render();
    }
  }

  private render() {
    const top = this.pageStarts[this.pageIndex] ?? 0;
    this.page.style.transform = `translateY(-${top}px)`;
    const count = this.pageStarts.length;
    this.prevBtn.disabled = this.pageIndex <= 0;
    this.nextBtn.disabled = this.pageIndex >= count - 1;
    this.indicator.textContent = `${Math.min(this.pageIndex + 1, count)} / ${count}`;
    this.selectedActions.style.display = this.props.selectedId ? "flex" : "none";
  }

  /** Rebuild block DOM and jump to the page containing the selection. */
  update(props: PaginatedReaderProps) {
    this.props = props;
    this.page.innerHTML = "";
    for (const block of props.blocks) {
      if (block.type === "yaml") continue;
      const el = renderBlock(block, props.runsByBlock.get(block.id) ?? [], props.selectedId === block.id, {
        onSelect: () => props.onSelect(block.id),
        onOpen: () => props.onOpen(block.id),
      });
      this.page.appendChild(el);
    }
    // offsetTop/offsetHeight force a synchronous layout read — no need to
    // wait for a frame (rAF is throttled or paused entirely for background /
    // non-focused tabs, which would leave pagination uninitialized).
    this.recompute();
    if (props.selectedId) {
      const el = this.page.querySelector<HTMLElement>(`[data-block-id="${props.selectedId}"]`);
      if (el) {
        const elTop = el.offsetTop;
        let target = 0;
        for (let i = 0; i < this.pageStarts.length; i++) {
          if (this.pageStarts[i] <= elTop + 1) target = i;
        }
        this.pageIndex = target;
      }
    }
    this.render();
  }

  destroy() {
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKey);
  }
}
