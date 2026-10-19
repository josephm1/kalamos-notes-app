import { describe, it, expect } from "vitest";
import { reduce, initialState, activeBlockId } from "./machine";

describe("edit state machine", () => {
  it("moves READING -> BLOCK_SELECTED -> EDITING -> COMMITTING -> READING", () => {
    let s = initialState;
    s = reduce(s, { type: "SELECT_BLOCK", blockId: "b1" });
    expect(s.name).toBe("BLOCK_SELECTED");
    s = reduce(s, { type: "OPEN_EDIT", blockId: "b1", mode: "ink" });
    expect(s.name).toBe("EDITING");
    s = reduce(s, { type: "COMMIT" });
    expect(s.name).toBe("COMMITTING");
    s = reduce(s, { type: "COMMIT_DONE" });
    expect(s.name).toBe("READING");
  });

  it("cancels from editing back to reading", () => {
    let s = reduce(initialState, { type: "OPEN_EDIT", blockId: "b1", mode: "text" });
    s = reduce(s, { type: "CANCEL" });
    expect(s.name).toBe("CANCELLING");
    s = reduce(s, { type: "CANCEL_DONE" });
    expect(s.name).toBe("READING");
  });

  it("recovers from an error to the previous safe state", () => {
    let s = reduce(initialState, { type: "OPEN_EDIT", blockId: "b1", mode: "ink" });
    s = reduce(s, { type: "ERROR", message: "boom" });
    expect(s.name).toBe("ERROR_RECOVERABLE");
    s = reduce(s, { type: "RECOVER" });
    expect(s.name).toBe("READING");
  });

  it("reports the active block id while editing", () => {
    const s = reduce(initialState, { type: "OPEN_EDIT", blockId: "b7", mode: "ink" });
    expect(activeBlockId(s)).toBe("b7");
  });

  it("ignores impossible transitions", () => {
    const s = reduce(initialState, { type: "COMMIT" });
    expect(s.name).toBe("READING");
  });
});
