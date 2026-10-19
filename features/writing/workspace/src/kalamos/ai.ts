// Write AI panel — on-device revise/continue for the open document, built on
// the shared Kalamos AI stack (window.AiKit from core's ai-kit.js bundle,
// provider config in window.AiBus). The agent's edits land through
// VanillaApp.applyExternalSource, so they're undoable like any pen commit.

import type { VanillaApp } from "../vanilla/main";

type AiKitEvent = {
  type: string; delta?: string; toolId?: string; name?: string; phase?: string;
  content?: string; isError?: boolean; message?: string; stopReason?: string;
};

type AiKitGlobal = {
  chat(opts: unknown): string;
  run(opts: {
    cfg: { backend: string; baseUrl?: string; keyRef?: string; model: string };
    system?: string;
    messages: unknown[];
    maxTokens?: number;
    tools: unknown[];
    execTool: (name: string, args: unknown) => Promise<{ content: string; isError?: boolean }>;
    maxTurns?: number;
    onEvent: (ev: AiKitEvent) => void;
  }): string;
  cancel(id: string): void;
};

type AiBusProvider = {
  id: string; kind: string; backend?: string; label?: string;
  baseUrl?: string; keyRef?: string; model?: string; maxTokens?: number;
};

type AiBusGlobal = {
  config(): { activeId: string; providers: AiBusProvider[] };
  saveConfig(): void;
  active(): AiBusProvider | null;
};

function aiKit(): AiKitGlobal | null {
  const w = window as unknown as { AiKit?: AiKitGlobal };
  return w.AiKit ?? null;
}

function aiBus(): AiBusGlobal | null {
  const w = window as unknown as { AiBus?: AiBusGlobal };
  return w.AiBus ?? null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function abCall(method: string, args: Record<string, unknown>): Record<string, unknown> {
  try {
    const w = window as unknown as { AppBridge?: { call(m: string, a: string): string } };
    if (!w.AppBridge) return { err: "no-app-bridge" };
    return JSON.parse(w.AppBridge.call(method, JSON.stringify(args)));
  } catch (e) {
    return { err: String(e) };
  }
}

const SYSTEM =
  "You are the writing assistant inside a pen-first markdown editor on an e-ink device. " +
  "Work on the user's open document with the provided tools: call read_document first, " +
  "then apply ONE replace_document (or insert_after_heading) with the full revised " +
  "markdown. Preserve the author's voice, structure, and markdown formatting; make the " +
  "smallest change that satisfies the instruction. Finish with one short sentence " +
  "describing what changed.";

const TOOLS = [
  {
    name: "read_document",
    description: "Read the open document's full markdown source.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "replace_document",
    description: "Replace the ENTIRE document with new markdown. Include all unchanged parts verbatim.",
    parameters: {
      type: "object",
      properties: { markdown: { type: "string" } },
      required: ["markdown"],
      additionalProperties: false,
    },
  },
  {
    name: "insert_after_heading",
    description: "Insert markdown immediately after the heading line whose text matches `heading`.",
    parameters: {
      type: "object",
      properties: { heading: { type: "string" }, markdown: { type: "string" } },
      required: ["heading", "markdown"],
      additionalProperties: false,
    },
  },
];

export class WriteAiPanel {
  private el: HTMLElement | null = null;
  private runId: string | null = null;

  constructor(private app: VanillaApp) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  close() {
    if (this.runId) {
      aiKit()?.cancel(this.runId);
      this.runId = null;
    }
    this.el?.remove();
    this.el = null;
  }

  open() {
    if (this.el) { this.close(); return; }
    const panel = document.createElement("div");
    panel.className = "w2ai-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "AI assistant");
    this.el = panel;
    document.body.appendChild(panel);
    this.renderIdle();
  }

  private provider(): AiBusProvider | null {
    const bus = aiBus();
    const p = bus?.active();
    return p && p.kind === "aisdk" ? p : null;
  }

  private renderIdle() {
    const panel = this.el!;
    const prov = this.provider();
    if (!aiKit() || !aiBus()) {
      panel.innerHTML = '<div class="hd"><h3>AI assistant</h3><button class="w2ai-close">✕</button></div>' +
        '<p>The AI stack is not available in this build.</p>';
      (panel.querySelector(".w2ai-close") as HTMLElement).onclick = () => this.close();
      return;
    }
    if (!prov) { this.renderSetup(); return; }

    panel.innerHTML =
      '<div class="hd"><h3>AI assistant</h3><span class="w2ai-prov">' + esc(prov.label || prov.backend || "") +
      " · " + esc(prov.model || "") + '</span><button class="w2ai-close" aria-label="Close">✕</button></div>' +
      '<textarea class="w2ai-input" rows="2" placeholder="What should change? e.g. “tighten the second section”"></textarea>' +
      '<div class="w2ai-actions">' +
      '<button class="w2ai-go" data-mode="revise">Revise</button>' +
      '<button class="w2ai-go" data-mode="continue">Continue writing</button>' +
      "</div>" +
      '<div class="w2ai-log" aria-live="polite"></div>';
    (panel.querySelector(".w2ai-close") as HTMLElement).onclick = () => this.close();
    for (const b of Array.from(panel.querySelectorAll<HTMLButtonElement>(".w2ai-go"))) {
      b.onclick = () => this.start(b.dataset.mode as "revise" | "continue");
    }
    (panel.querySelector(".w2ai-input") as HTMLTextAreaElement).focus();
  }

  /** First-run: pick ChatGPT or DeepSeek and paste a key, right in the panel. */
  private renderSetup() {
    const panel = this.el!;
    panel.innerHTML =
      '<div class="hd"><h3>Set up AI</h3><button class="w2ai-close" aria-label="Close">✕</button></div>' +
      "<p>Pick a provider and paste its API key (stored on this device only).</p>" +
      '<div class="w2ai-setup">' +
      '<label><input type="radio" name="w2ai-be" value="openai" checked> ChatGPT (OpenAI)</label>' +
      '<label><input type="radio" name="w2ai-be" value="deepseek"> DeepSeek</label>' +
      '<input class="w2ai-key" type="password" placeholder="API key">' +
      '<button class="w2ai-save">Save</button>' +
      "</div>";
    (panel.querySelector(".w2ai-close") as HTMLElement).onclick = () => this.close();
    (panel.querySelector(".w2ai-save") as HTMLElement).onclick = () => {
      const be = (panel.querySelector('input[name="w2ai-be"]:checked') as HTMLInputElement).value;
      const key = (panel.querySelector(".w2ai-key") as HTMLInputElement).value.trim();
      if (!key) return;
      const bus = aiBus()!;
      const cfg = bus.config();
      const keyRef = be === "deepseek" ? "deepseek_key" : "openai_key";
      const r = abCall("secret.set", { key: keyRef, value: key });
      if (r.err) {
        try { localStorage.setItem("scribe_secret_" + keyRef, key); } catch { /* preview only */ }
      }
      let p = cfg.providers.find((x) => x.kind === "aisdk" && x.backend === be);
      if (!p) {
        p = be === "deepseek"
          ? { id: "aisdk-ds", kind: "aisdk", backend: "deepseek", label: "DeepSeek", model: "deepseek-chat", keyRef, maxTokens: 4096 }
          : { id: "aisdk-oa", kind: "aisdk", backend: "openai", label: "ChatGPT", baseUrl: "https://api.openai.com/v1", model: "gpt-5", keyRef, maxTokens: 4096 };
        cfg.providers.push(p);
      }
      cfg.activeId = p.id;
      bus.saveConfig();
      this.renderIdle();
    };
  }

  private line(text: string, cls = "") {
    const log = this.el?.querySelector(".w2ai-log");
    if (!log) return;
    const d = document.createElement("div");
    d.className = "w2ai-line " + cls;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  private start(mode: "revise" | "continue") {
    if (this.runId) return;
    const kit = aiKit();
    const prov = this.provider();
    const source = this.app.getSource();
    if (!kit || !prov || source === null) return;
    const inputEl = this.el!.querySelector(".w2ai-input") as HTMLTextAreaElement;
    const instruction = inputEl.value.trim();
    if (mode === "revise" && !instruction) { inputEl.focus(); return; }

    const log = this.el!.querySelector(".w2ai-log")!;
    log.innerHTML = "";
    this.line("Working…", "status");

    const userText = mode === "continue"
      ? "Continue writing this document from where it ends, matching its tone and style." +
        (instruction ? " Guidance: " + instruction : "")
      : instruction;

    const textParts: string[] = [];
    this.runId = kit.run({
      cfg: { backend: prov.backend || "openai", baseUrl: prov.baseUrl || undefined, keyRef: prov.keyRef || undefined, model: prov.model || "" },
      system: SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
      maxTokens: prov.maxTokens || 4096,
      tools: TOOLS,
      execTool: async (name, args) => this.execTool(name, args as Record<string, unknown>),
      maxTurns: 5,
      onEvent: (ev) => {
        if (ev.type === "tool_use" && ev.phase === "start") this.line("→ " + (ev.name || "tool"), "tool");
        else if (ev.type === "tool_result") this.line((ev.isError ? "✕ " : "✓ ") + String(ev.content).slice(0, 120), ev.isError ? "err" : "ok");
        else if (ev.type === "text" && ev.delta) textParts.push(ev.delta);
        else if (ev.type === "error") { this.line("⚠ " + (ev.message || "error"), "err"); this.runId = null; }
        else if (ev.type === "done") {
          this.runId = null;
          const summary = textParts.join("").trim();
          if (summary) this.line(summary, "answer");
          this.line(ev.stopReason === "cancelled" ? "Cancelled." : "Done — undo with ⌘/Ctrl-Z if needed.", "status");
        }
      },
    });
  }

  private async execTool(name: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
    const source = this.app.getSource();
    if (source === null) return { content: "No document open.", isError: true };
    if (name === "read_document") return { content: source.slice(0, 48000) };
    if (name === "replace_document") {
      const md = String(args.markdown ?? "");
      if (!md.trim()) return { content: "Refusing to replace the document with empty text.", isError: true };
      return this.app.applyExternalSource(md)
        ? { content: "Document replaced." }
        : { content: "No change (text identical).", isError: false };
    }
    if (name === "insert_after_heading") {
      const heading = String(args.heading ?? "").trim().toLowerCase();
      const md = String(args.markdown ?? "");
      if (!heading || !md) return { content: "heading and markdown are required.", isError: true };
      const lines = source.split("\n");
      const idx = lines.findIndex((l) => /^#{1,6}\s+/.test(l) && l.replace(/^#{1,6}\s+/, "").trim().toLowerCase() === heading);
      if (idx < 0) return { content: "Heading not found: " + heading, isError: true };
      lines.splice(idx + 1, 0, "", md);
      this.app.applyExternalSource(lines.join("\n"));
      return { content: "Inserted after “" + heading + "”." };
    }
    return { content: "Unknown tool " + name, isError: true };
  }
}
