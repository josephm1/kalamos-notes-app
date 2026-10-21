import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fingerprintOf } from "../documents/fingerprint";
import type { DocStore, PersistState } from "../documents/store";
import { DEFAULT_PREFERENCES } from "../storage/preferences";
import { createApp } from "./main";
import { PenWorkspace } from "./penWorkspace";
import { Write2Native } from "../kalamos/native";

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    fill: () => {},
  });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  document.body.replaceChildren();
});

function store(persist: (state: PersistState) => Promise<void>): DocStore {
  return {
    loadSidecar: async () => undefined,
    loadRecovery: async () => undefined,
    persist,
    loadPreferences: async () => DEFAULT_PREFERENCES,
    savePreferences: async () => {},
  };
}

describe("direct ruled workspace", () => {
  it("opens a blank document directly in the full writing editor", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const persist = vi.fn(async (_state: PersistState) => {});
    const app = createApp(host, {
      store: store(persist),
      chrome: "kalamos",
      directWorkspace: true,
    });

    await app.openDocument({
      docId: "planning-1",
      name: "Project plan",
      source: "",
      fingerprint: fingerprintOf(""),
      handle: null,
    });

    expect(host.classList.contains("direct-workspace")).toBe(true);
    expect(host.querySelector(".reader-viewport")).toBeNull();
    expect(host.querySelector(".v-modal-title")?.textContent).toBe("Project plan");
    expect(host.querySelector(".v-modal")?.classList.contains("toolbar-mode-collapsed")).toBe(true);
    expect(host.querySelector(".reflow-surface")).not.toBeNull();
    expect(host.querySelector('button[aria-label="Spacing tools"]')).not.toBeNull();
    expect((host.querySelector(".delete-ink") as HTMLElement).style.display).toBe("none");
    expect((host.querySelector(".convert-ink") as HTMLElement).style.display).toBe("none");
    expect(host.querySelector('[data-action="cancel"]')).toBeNull();
    expect(host.querySelector('[data-action="done"]')).toBeNull();
    expect(host.querySelector('[data-action="toolbar-expand"]')).not.toBeNull();
    expect(host.querySelector(".toolbar-core")).not.toBeNull();
    expect(host.querySelector(".toolbar-more-rail")).not.toBeNull();

    app.destroy();
  });

  it("auto-commits, persists, and exits from the outer close control", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const saved: PersistState[] = [];
    const persist = vi.fn(async (state: PersistState) => { saved.push(state); });
    const onExit = vi.fn();
    const app = createApp(host, {
      store: store(persist),
      chrome: "kalamos",
      directWorkspace: true,
      onExit,
    });
    await app.openDocument({
      docId: "planning-2",
      name: "Weekly plan",
      source: "\u200b",
      fingerprint: fingerprintOf("\u200b"),
      handle: null,
    });

    (host.querySelector(".v-modal-header button") as HTMLButtonElement).click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(persist).toHaveBeenCalledTimes(1);
    expect(saved[0]?.docId).toBe("planning-2");
    expect(onExit).toHaveBeenCalledTimes(1);

    app.destroy();
  });

  it('coalesces concurrent checkpoints without replacing the pending native flush callback', async()=>{
    const host=document.createElement('div');document.body.append(host);let finish!:()=>void;
    const persist=vi.fn(()=>new Promise<void>(r=>{finish=r;}));
    const app=createApp(host,{store:store(persist),chrome:'kalamos',directWorkspace:true,onExit:vi.fn()});
    await app.openDocument({docId:'coalesced',name:'Coalesced',source:'Text',fingerprint:fingerprintOf('Text'),handle:null});
    const first=app.checkpointWorkspace(),second=app.checkpointWorkspace();expect(first).toBe(second);
    expect(persist).toHaveBeenCalledOnce();finish();await first;expect(app.isEditing()).toBe(true);app.destroy();
  });

  it("checkpoints a direct workspace without exiting it", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const persist = vi.fn(async (_state: PersistState) => {});
    const onExit = vi.fn();
    const app = createApp(host, {
      store: store(persist),
      chrome: "kalamos",
      directWorkspace: true,
      onExit,
    });
    await app.openDocument({
      docId: "planning-checkpoint",
      name: "Pause-safe plan",
      source: "\u200b",
      fingerprint: fingerprintOf("\u200b"),
      handle: null,
    });

    await app.checkpointWorkspace();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(app.isEditing()).toBe(true);
    app.destroy();
  });

  it("lets a direct host capture its thumbnail before native paper teardown", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const events: string[] = [];
    let app: ReturnType<typeof createApp>;
    app = createApp(host, {
      store: store(async () => {}),
      chrome: "kalamos",
      directWorkspace: true,
      onExit: () => {
        events.push("capture");
        app.destroy();
      },
      nativeHooks: {
        native: false,
        onWorkspaceClose: () => events.push("detach"),
      },
    });
    await app.openDocument({
      docId: "planning-3",
      name: "Thumbnail order",
      source: "\u200b",
      fingerprint: fingerprintOf("\u200b"),
      handle: null,
    });

    (host.querySelector(".v-modal-header button") as HTMLButtonElement).click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(events).toEqual(["capture", "detach"]);
  });
});

describe('whole Markdown planning canvas', () => {
  it('keeps headings, paragraphs and lists on the canvas and preserves source on checkpoint', async () => {
    const source = '# Heading\n\nAlpha beta\n\n- First task\n- Second task\n';
    const host = document.createElement('div'); document.body.append(host);
    const saved: PersistState[] = [];
    const app = createApp(host,{store:store(async state=>{saved.push(state)}),chrome:'kalamos',directWorkspace:true});
    await app.openDocument({docId:'import',name:'Imported',source,fingerprint:fingerprintOf(source),handle:null});
    expect(host.querySelector('.reflow-surface')!.textContent).toContain('Second');
    await app.checkpointWorkspace();
    expect(saved[saved.length - 1]!.source).toBe(source);
    expect(saved[saved.length - 1]!.sidecar.sourceWords?.some(w=>w.text === 'Second')).toBe(true);
    app.destroy();
  });
});

describe('separate notebook page controls', () => {
  it('shows current sheet and sends page actions through the host while sharing dialog ownership', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const change = vi.fn();
    const app = createApp(host, {store:store(async()=>{}),chrome:'kalamos',directWorkspace:true,
      pageTools:{index:0,count:2,change}});
    await app.openDocument({docId:'pages-qa',name:'Pages',source:'\u200b',fingerprint:fingerprintOf('\u200b'),handle:null});
    (host.querySelector('[data-action="pages"]') as HTMLButtonElement).click();
    const panel = host.querySelector('[aria-label="Notebook pages"]')!;
    expect(panel.textContent).toContain('Page 1 of 2');
    const buttons = Array.from(panel.querySelectorAll('button'));
    expect(buttons.find(b=>b.textContent==='Previous page')!.disabled).toBe(true);
    buttons.find(b=>b.textContent==='Add page')!.click();
    expect(change).toHaveBeenCalledWith('add');
    expect(host.querySelector('[aria-label="Notebook pages"]')).toBeNull();
    app.destroy(); host.remove();
  });
});

it('keeps the ruled sheet open when its exit save fails', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const onExit = vi.fn(), alert = vi.spyOn(window,'alert').mockImplementation(()=>{});
  const warning = vi.spyOn(console,'warn').mockImplementation(()=>{});
  const app = createApp(host,{store:store(async()=>{throw new Error('disk write failed')}),chrome:'kalamos',directWorkspace:true,onExit});
  await app.openDocument({docId:'failed-exit',name:'Keep page',source:'Text',fingerprint:fingerprintOf('Text'),handle:null});
  (host.querySelector('[aria-label="Close editor"]') as HTMLButtonElement).click();
  await new Promise(resolve=>window.setTimeout(resolve,0));
  expect(onExit).not.toHaveBeenCalled(); expect(app.isEditing()).toBe(true); expect(alert).toHaveBeenCalled();
  app.destroy(); alert.mockRestore(); warning.mockRestore();
});

it('turns existing sheets with direct arrows and horizontal finger swipes without creating pages', async () => {
  const host=document.createElement('div');document.body.append(host);
  const change=vi.fn();
  const app=createApp(host,{store:store(async()=>{}),chrome:'kalamos',directWorkspace:true,pageTools:{index:1,count:3,change}});
  await app.openDocument({docId:'touch-pages',name:'Touch pages',source:'Text',fingerprint:fingerprintOf('Text'),handle:null});
  for(const [name,action] of [['page--1',-1],['page-1',1],['page-add','add']] as const) {
    (host.querySelector(`[data-action="${name}"]`) as HTMLButtonElement).click(); expect(change).toHaveBeenLastCalledWith(action);
  }
  change.mockClear();
  const surface=host.querySelector('.reflow-surface') as HTMLElement;
  surface.getBoundingClientRect=()=>({left:0,top:0,width:500,height:700,right:500,bottom:700,x:0,y:0,toJSON:()=>({})});
  const touch=(type:string,x:number,y=200)=>{
    const e=new MouseEvent(type,{bubbles:true,clientX:x,clientY:y});
    Object.defineProperties(e,{pointerId:{value:42},pointerType:{value:'touch'}});surface.dispatchEvent(e);
  };
  touch('pointerdown',450);touch('pointermove',300);touch('pointerup',300);expect(change).toHaveBeenLastCalledWith(1);
  touch('pointerdown',50);touch('pointermove',200);touch('pointerup',200);expect(change).toHaveBeenLastCalledWith(-1);
  change.mockClear();touch('pointerdown',450);touch('pointerup',450);expect(change).not.toHaveBeenCalled();touch('pointerdown',250);touch('pointerup',250);expect(change).not.toHaveBeenCalled();
  touch('pointerdown',450);touch('pointermove',450,240);touch('pointerup',450,240);expect(change).not.toHaveBeenCalled();
  touch('pointerdown',450);touch('pointercancel',450);expect(change).not.toHaveBeenCalled();
  touch('pointerdown',450);touch('pointerup',425);expect(change).not.toHaveBeenCalled();
  touch('pointerdown',450);touch('pointerup',300,300);expect(change).not.toHaveBeenCalled();
  touch('pointerdown',450);touch('pointermove',300);touch('pointercancel',300);expect(change).not.toHaveBeenCalled();
  let now=5000;const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
  touch('pointerdown',450);now+=1100;touch('pointerup',300);expect(change).not.toHaveBeenCalled();clock.mockRestore();
  surface.scrollTop=100;
  touch('pointerdown',450);touch('pointermove',300,202);touch('pointerup',300,202);
  expect(surface.scrollTop).toBe(100);expect(change).toHaveBeenCalledTimes(1);change.mockClear();
  touch('pointerdown',450);touch('pointermove',448,240);touch('pointerup',448,240);
  expect(surface.scrollTop).toBe(60);expect(change).not.toHaveBeenCalled();
  (host.querySelector('[data-action="pages"]') as HTMLButtonElement).click();
  touch('pointerdown',450);touch('pointerup',300);expect(change).not.toHaveBeenCalled();
  app.destroy();
});

it('idle native save keeps the complete direct-editor DOM unchanged while persisting erased ink and an image', async()=>{
 const host=document.createElement('div');document.body.append(host);
 const persist=vi.fn(async (_state:PersistState)=>{});
 const native=new Write2Native();let workspace!:PenWorkspace;
 const app=createApp(host,{store:store(persist),chrome:'kalamos',directWorkspace:true,
  nativeHooks:{native:true,onWorkspaceOpen:ws=>{workspace=ws;}}});
 try {
  await app.openDocument({docId:'quiet-save',name:'Quiet save',source:'\u200b',fingerprint:fingerprintOf('\u200b'),handle:null});
  // The loaded image reference is ordinary page data; an idle save must not repaint any chrome.
  const image={id:'photo',kind:'image',x:120,y:80,width:100,height:80,color:'#000',strokeWidth:1,
   attachment:{id:'a'.repeat(64),name:'Photo.jpg',mime:'image/jpeg',width:200,height:160}};
  (workspace as any).doc={...workspace.reflowDoc,pageObjects:[image]};
  workspace.applyNativeWriteStroke(Array.from({length:8},(_,i)=>({x:20,y:10+i*3,t:i*4,pressure:.5})),false);
  const point=workspace.getNativeInkStrokes()[0].pts[4];
  const scrub=Array.from({length:7},(_,i)=>({x:point.x+(i%2?45:-45),y:point.y-6+i*2,t:i*4,pressure:.5}));
  expect(workspace.applyNativeWriteStroke(scrub,false)).not.toBeNull();
  workspace.reconcileNativeCommand();expect(workspace.getNativeInkStrokes()).toHaveLength(0);
  await Promise.resolve();
  const changes:MutationRecord[]=[];
  const mutation=new MutationObserver(records=>changes.push(...records));mutation.observe(host,{subtree:true,childList:true,attributes:true,characterData:true});
  const before=host.innerHTML;
  Object.assign(native,{ws:workspace,attached:true});
  native.onNativeSaveRequested();await Promise.resolve();await Promise.resolve();
  changes.push(...mutation.takeRecords());mutation.disconnect();
  expect(persist).toHaveBeenCalledOnce();
  expect(persist.mock.calls[0][0].sidecar.inkRuns).toEqual([]);
  expect(persist.mock.calls[0][0].sidecar.pageObjects).toEqual([image]);
  expect(app.isEditing()).toBe(true);expect(host.innerHTML).toBe(before);
  expect(changes.map(r=>({type:r.type,target:(r.target as HTMLElement).className}))).toEqual([]);
 }finally{app.destroy();}
});
