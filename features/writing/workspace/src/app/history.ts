// Undo/redo as a core editing model (BUILD_PLAN.md §3, §12). A command captures
// enough state to move the document + sidecar forward and back.

export type Command<S> = {
  label: string;
  before: S;
  after: S;
};

export class History<S> {
  private undoStack: Command<S>[] = [];
  private redoStack: Command<S>[] = [];
  private limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  push(command: Command<S>): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): S | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    this.redoStack.push(cmd);
    return cmd.before;
  }

  redo(): S | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    this.undoStack.push(cmd);
    return cmd.after;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
