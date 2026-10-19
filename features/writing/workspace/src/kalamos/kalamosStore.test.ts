import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptySidecar } from "../sidecar/schema";
import { createKalamosStore, readDocSource } from "./kalamosStore";

type TestBridge = {
  getNotebookFile: ReturnType<typeof vi.fn>;
  saveNotebookFile: ReturnType<typeof vi.fn>;
  getBookFile: ReturnType<typeof vi.fn>;
  saveBookFile: ReturnType<typeof vi.fn>;
};

function installBridge(): TestBridge {
  const bridge = {
    getNotebookFile: vi.fn(() => "# Planning"),
    saveNotebookFile: vi.fn(() => "ok"),
    getBookFile: vi.fn(() => "wrong store"),
    saveBookFile: vi.fn(() => "ok"),
  };
  Object.defineProperty(globalThis, "Bridge", {
    configurable: true,
    value: bridge,
  });
  return bridge;
}

describe("Kalamos writing-document storage", () => {
  afterEach(() => {
    localStorage.clear();
    delete (globalThis as typeof globalThis & { Bridge?: unknown }).Bridge;
  });

  it("uses host spacing defaults without overwriting saved writing geometry", async () => {
    const store = createKalamosStore({ preferencesKey: "test.planning", defaultPreferences: { lineHeight: 56, penColor: "#000000" } });
    expect((await store.loadPreferences()).lineHeight).toBe(56);
    expect((await store.loadPreferences()).penColor).toBe("#000000");
    await store.savePreferences({ ...(await store.loadPreferences()), lineHeight: 44 });
    expect((await store.loadPreferences()).lineHeight).toBe(44);
  });

  it("reads Planning source from its notebook record, not book storage", () => {
    const bridge = installBridge();

    expect(readDocSource("planning-1", "planning.md")).toBe("# Planning");
    expect(bridge.getNotebookFile).toHaveBeenCalledWith("planning-1", "planning.md");
    expect(bridge.getBookFile).not.toHaveBeenCalled();
  });

  it("persists Planning source and ink beside notebook metadata", async () => {
    const bridge = installBridge();
    const store = createKalamosStore({
      sourceFile: "planning.write2.md",
      sidecarFile: "planning.write2.json",
    });
    const sidecar = createEmptySidecar("Planning", "fingerprint");

    await store.persist({
      docId: "planning-1",
      documentName: "Planning",
      source: "# Planning",
      sidecar,
      dirty: true,
    });

    expect(bridge.saveNotebookFile).toHaveBeenNthCalledWith(
      1,
      "planning-1",
      "planning.write2.md",
      "# Planning"
    );
    expect(bridge.saveNotebookFile).toHaveBeenNthCalledWith(
      2,
      "planning-1",
      "planning.write2.json",
      JSON.stringify(sidecar)
    );
    expect(bridge.saveBookFile).not.toHaveBeenCalled();
  });
});

it('rejects failed sheet writes so page navigation cannot discard the open model', async () => {
  const bridge = installBridge(); bridge.saveNotebookFile.mockReturnValue('error');
  await expect(createKalamosStore().persist({docId:'qa',documentName:'QA',source:'Keep me',sidecar:createEmptySidecar('QA','fp'),dirty:true})).rejects.toThrow('could not be saved');
  delete (globalThis as typeof globalThis & { Bridge?: unknown }).Bridge;
});
