// Explicit edit-lifecycle state machine (BUILD_PLAN.md §9 "Core state machine").
//   READING -> BLOCK_SELECTED -> EDITING_TEXT | EDITING_INK -> COMMITTING -> READING
//   Any editing state -> CANCELLING -> READING
//   Any state -> ERROR_RECOVERABLE -> previous safe state
// Represented explicitly to avoid impossible combinations of scattered booleans.

export type EditMode = "text" | "ink";

export type MachineState =
  | { name: "READING" }
  | { name: "BLOCK_SELECTED"; blockId: string }
  | { name: "EDITING"; blockId: string; mode: EditMode }
  | { name: "COMMITTING"; blockId: string; mode: EditMode }
  | { name: "CANCELLING"; blockId: string }
  | { name: "ERROR_RECOVERABLE"; message: string; safe: MachineState };

export type MachineEvent =
  | { type: "SELECT_BLOCK"; blockId: string }
  | { type: "OPEN_EDIT"; blockId: string; mode: EditMode }
  | { type: "SET_MODE"; mode: EditMode }
  | { type: "COMMIT" }
  | { type: "COMMIT_DONE" }
  | { type: "CANCEL" }
  | { type: "CANCEL_DONE" }
  | { type: "DESELECT" }
  | { type: "ERROR"; message: string }
  | { type: "RECOVER" };

export const initialState: MachineState = { name: "READING" };

export function reduce(state: MachineState, event: MachineEvent): MachineState {
  switch (event.type) {
    case "ERROR":
      return { name: "ERROR_RECOVERABLE", message: event.message, safe: safeStateOf(state) };
    case "RECOVER":
      return state.name === "ERROR_RECOVERABLE" ? state.safe : state;
    case "SELECT_BLOCK":
      if (state.name === "READING" || state.name === "BLOCK_SELECTED") {
        return { name: "BLOCK_SELECTED", blockId: event.blockId };
      }
      return state;
    case "OPEN_EDIT":
      if (state.name === "READING" || state.name === "BLOCK_SELECTED") {
        return { name: "EDITING", blockId: event.blockId, mode: event.mode };
      }
      return state;
    case "SET_MODE":
      if (state.name === "EDITING") {
        return { ...state, mode: event.mode };
      }
      return state;
    case "COMMIT":
      if (state.name === "EDITING") {
        return { name: "COMMITTING", blockId: state.blockId, mode: state.mode };
      }
      return state;
    case "COMMIT_DONE":
      if (state.name === "COMMITTING") return { name: "READING" };
      return state;
    case "CANCEL":
      if (state.name === "EDITING" || state.name === "COMMITTING") {
        return { name: "CANCELLING", blockId: state.blockId };
      }
      return state;
    case "CANCEL_DONE":
      if (state.name === "CANCELLING") return { name: "READING" };
      return state;
    case "DESELECT":
      if (state.name === "BLOCK_SELECTED") return { name: "READING" };
      return state;
    default:
      return state;
  }
}

function safeStateOf(state: MachineState): MachineState {
  // The nearest non-error state we can return to.
  if (state.name === "ERROR_RECOVERABLE") return state.safe;
  if (state.name === "EDITING" || state.name === "COMMITTING" || state.name === "CANCELLING") {
    return { name: "READING" };
  }
  return state;
}

export function activeBlockId(state: MachineState): string | null {
  switch (state.name) {
    case "BLOCK_SELECTED":
    case "EDITING":
    case "COMMITTING":
    case "CANCELLING":
      return state.blockId;
    default:
      return null;
  }
}

export function isEditing(state: MachineState): boolean {
  return state.name === "EDITING" || state.name === "COMMITTING";
}
