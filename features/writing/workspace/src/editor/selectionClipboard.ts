import type { Insert } from './reflowModel';
import type { TextBox } from '../sidecar/schema';
import type { Bounds } from '../ink/types';

export type SelectionClip = { bounds: Bounds; ink?: Insert; textBoxes: TextBox[] };
const key = 'kalamos.writing.selectionClipboard.v1';
let clipboard: SelectionClip | null | undefined;
const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value));
/** Persist and verify BEFORE Cut removes anything. Page turns and process recreation must not
 * strand a cut selection in a destroyed editor. Content remains in the app's private WebView store. */
export function writeSelectionClipboard(value: SelectionClip) {
  const serialized=JSON.stringify(value);
  localStorage.setItem(key,serialized);
  if(localStorage.getItem(key)!==serialized)throw new Error('Could not save the selection clipboard.');
  clipboard=clone(value);
}
function loadClipboard() {
  if(clipboard===undefined){
    try {
      const raw=localStorage.getItem(key),value=raw?JSON.parse(raw):null;
      clipboard=value && Array.isArray(value.textBoxes) && value.bounds &&
        ['x','y','width','height'].every(field=>Number.isFinite(value.bounds[field])) ? value : null;
    } catch { clipboard=null; }
  }
  return clipboard;
}
export function readSelectionClipboard(): SelectionClip | null {
  const value=loadClipboard();return value ? clone(value) : null;
}
export function hasSelectionClipboard() { return loadClipboard() !== null; }
export function clearSelectionClipboard() { localStorage.removeItem(key); clipboard=null; }
