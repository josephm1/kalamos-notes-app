/** Android stylus taps do not consistently synthesize click. Activate on a matching pen
 * release, then suppress that contact's compatibility click; fingers and mouse keep click. */
export function bindPenButton(button: HTMLButtonElement, action: () => void, ownsPenRelease = true): void {
  let pointer: number | null = null;
  let activatedAt = -Infinity;
  button.addEventListener("pointerdown", event => {
    event.stopPropagation();
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
    activatedAt = performance.now();
    action();
  });
  button.addEventListener("click", () => {
    if (performance.now() - activatedAt > 600) action();
  });
}
