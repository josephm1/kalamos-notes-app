/** Small, monochrome tool glyphs share currentColor so selected controls invert cleanly. */
export function inkToolIcon(kind:string):string {
 const paths:Record<string,string>={
  prev:'<path d="M15 4l-8 8 8 8"/>',
  next:'<path d="M9 4l8 8-8 8"/>',
  back:'<path d="M9 5L3 11l6 6M3 11h11a6 6 0 010 12"/>',
  close:'<path d="M5 5l14 14M19 5L5 19"/>',
  move:'<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4"/>',
  cover:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M11 8h6"/>',
  shapes:'<rect x="2" y="3" width="11" height="11" rx="1"/><circle cx="16" cy="16" r="6"/>',
  pen:'<path d="M4 20l2-7L17 2l5 5-11 11-7 2zM6 13l5 5M15 4l5 5M4 20l4-4"/>',
  brush:'<path d="M10 13l8-11 4 4-11 9M10 13c-5-3-4 6-8 7 5 2 10-1 9-5"/>',
  marker:'<path d="M5 14l9-12 7 5-9 12-7-5zM5 14l-2 5 6 3 3-3M3 22h9"/>',
  pixelEraser:'<circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/><path d="M9 12h6M12 9v6"/>',
  eraser:'<path d="M3 14l10-11 8 7-10 11H8l-5-7zM8 9l8 7M11 21h10"/>',
  lasso:'<path d="M19 17c2-2 3-5 2-7-2-6-17-7-19 0-2 7 7 11 12 8 5-3 1-7-3-5-4 2-2 7 3 9" stroke-dasharray="2 2"/>',
  check:'<path d="M4 12l5 5L20 5"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  delete:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>'
 };
 return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[kind]??paths.pen}</svg>`;
}
