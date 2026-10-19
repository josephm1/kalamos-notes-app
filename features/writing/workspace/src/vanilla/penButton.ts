/** Optional owner-held state survives replacement of a control's DOM node. */
export interface PenButtonActivation { activatedAt: number; nativePenContact?: boolean }

/** Android stylus taps do not consistently synthesize click. Activate on a matching pen
 * release, then suppress that contact's compatibility click; fingers and mouse keep click. */
export function bindPenButton(button: HTMLButtonElement, action: () => void, ownsPenRelease = true, activation: PenButtonActivation = { activatedAt: -Infinity }, nativeOwnsPen: () => boolean = () => false): void {
  let pointer: number | null = null;
  button.addEventListener("pointerdown", event => {
    event.stopPropagation();
    activation.nativePenContact = event.pointerType === "pen" && nativeOwnsPen();
    if (event.pointerType !== "pen") activation.activatedAt = -Infinity;
    if (event.pointerType === "pen" && !button.disabled) pointer = event.pointerId;
  });
  const cancel = () => { pointer = null; };
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("pointerleave", cancel);
  button.addEventListener("pointerup", event => {
    const pressedHere = pointer === event.pointerId;
    pointer = null;
    if (!ownsPenRelease || event.pointerType !== "pen" || !pressedHere || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (activation.nativePenContact) return;
    activation.activatedAt = performance.now();
    action();
  });
  button.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      activation.nativePenContact = false;
      activation.activatedAt = -Infinity;
    }
  });
  button.addEventListener("click", event => {
    // Native delivery can follow pointer-up by a full idle batch, and redraw replaces the node.
    // Retain ownership until a new finger/mouse/keyboard contact, not a debounce timeout.
    if (activation.nativePenContact || ((event as PointerEvent).pointerType === "pen" && nativeOwnsPen())) return;
    if (performance.now() - activation.activatedAt > 600) action();
  });
}
