import type { PenWorkspace } from "../vanilla/penWorkspace";

type TraceBridge = {
  isInkTraceEnabled?: () => boolean;
  traceInkSession?: (notebook: string, page: string, phase: string) => void;
  traceInkEvent?: (event: string, json: string) => void;
};
let enabled: boolean | undefined;
const workspaceIds = new WeakMap<object, number>();
let nextWorkspaceId = 0;
function bridge(): TraceBridge | undefined {
  return (window as unknown as { KalamosBridge?: TraceBridge }).KalamosBridge;
}
function tracing(): boolean {
  try { return enabled ??= bridge()?.isInkTraceEnabled?.() === true; }
  catch { return false; }
}
export function traceInkOwner(notebook: string, page: string, phase: string) {
  if (!tracing()) return;
  try { bridge()?.traceInkSession?.(notebook, page, phase); } catch { }
}
export function traceInkEvent(event: string, fields: Record<string, unknown>) {
  if (!tracing()) return;
  try { bridge()?.traceInkEvent?.(event, JSON.stringify(fields)); } catch { }
}
export function traceInkWorkspace(workspace: PenWorkspace | null, event: string, fields: Record<string, unknown> = {}) {
  if (!tracing() || !workspace) return;
  let id = workspaceIds.get(workspace);
  if (!id) { id = ++nextWorkspaceId; workspaceIds.set(workspace, id); }
  traceInkEvent(event, { ...fields, workspace: id, ...workspace.getInkDiagnosticState() });
}
