import type { PageObject } from './pageObjects';
import { objectMinimumSize } from './objectInk';

export const IMAGE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type ImageHandle = typeof IMAGE_HANDLES[number];

/** Opposite edge/corner stays fixed. Corners project the drag onto the current ratio. */
export function resizeImage(before: PageObject, handle: ImageHandle, dx: number, dy: number, pageWidth: number): PageObject {
  const west = handle.includes('w'), east = handle.includes('e');
  const north = handle.includes('n'), south = handle.includes('s');
  const min = objectMinimumSize(before);
  const right = before.x + before.width, bottom = before.y + before.height;
  const maxWidth = west ? right : pageWidth - before.x;
  const maxHeight = north ? bottom : Infinity;
  let width = before.width, height = before.height;
  if ((west || east) && (north || south)) {
    const signedX = west ? -dx : dx, signedY = north ? -dy : dy;
    const scale = 1 + (signedX * width + signedY * height) / (width * width + height * height);
    const lower = Math.max(min.width / width, min.height / height);
    const upper = Math.min(maxWidth / width, maxHeight / height);
    const bounded = Math.max(lower, Math.min(upper, scale));
    width *= bounded; height *= bounded;
  } else {
    if (west || east) width = Math.max(min.width, Math.min(maxWidth, width + (west ? -dx : dx)));
    if (north || south) height = Math.max(min.height, Math.min(maxHeight, height + (north ? -dy : dy)));
  }
  return { ...before, x: west ? right - width : before.x, y: north ? bottom - height : before.y, width, height };
}
