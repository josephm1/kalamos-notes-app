import type { DocumentAction } from "../vanilla/documentActions";
import type { PageAttachment, AudioStatus } from "../editor/pageAttachments";
import { markdownImportBlocks } from "../editor/markdownImport";
import { notebookSheetsToMarkdown } from "../editor/notebookMarkdown";
import { BackgroundSave } from "./backgroundSave";
import { traceInkOwner } from "./diagnostics";
// Kalamos device entry — builds `window.KalamosWriteWorkspace`, the managed
// ruled-writing surface shared by self-contained Kalamos apps. App-owned
// overlays own library routing and AppMode; this core module owns document
// editing, persistence seams, and native-ink orchestration.
//
// Bundled by vite.kalamos.config.ts into a single classic IIFE script
// (write-workspace.js) because the Kalamos WebView loads file:///android_asset pages
// where ES modules are CORS-blocked.

import { materializeSemantic, projectSemantic, copySemanticBindings, type SemanticBlock } from "../editor/semanticDocument";
import { materializeTranscriptionPage, type TranscriptionBlock, type InkRegion, type TranscriptionSheet } from "../editor/inkTranscription";
import { materializeImagePage } from "../editor/imagePageFormatting";
import { bindMarkdownResultToInk } from "../editor/markdownTranscription";
import { resolveRuledLineHeight } from "../editor/textBox";
import { showPageOverview, type OverviewAction } from "../vanilla/pageOverview";
import { reorderPages, removePages } from "./pageOrder";
import { PenWorkspace } from "../vanilla/penWorkspace";
import { createApp, type VanillaApp } from "../vanilla/main";
import { createKalamosStore, kalamosStore, readDocSource, saveNotebookFile } from "./kalamosStore";
import { kalamosStorage } from "./shell";
import { Write2Native } from "./native";
import { kalamosHwr } from "./hwr";
import { WriteAiPanel } from "./ai";
import { fingerprintOf } from "../documents/fingerprint";
import { SAMPLE_DOC } from "../test-fixtures/sample";
import { parsePages, appendPage, PAGES_FILE, type WorkspacePages } from "./workspacePages";
import { NOTEBOOK_TEMPLATES, createNotebookTemplate } from "../editor/notebookTemplates";
import { savePaginatedSheet } from "./sheetPagination";
import { validateSidecar } from "../sidecar/schema";
import { parseCustomNotebookTemplates } from "../editor/customNotebookTemplates";
import { GUIDE_DOC } from "./guideDoc";
import { convertLegacyPage } from "./legacyNotebook";

export type KalamosWriteWorkspaceApi = {
  materializeSemantic: typeof materializeSemantic;
  createMarkdownSheets(markdown:string,title:string):Promise<ReturnType<typeof materializeSemantic>>;
  materializeNotebookImage(notebookId:string,pageId:string,markdown:string,regions:InkRegion[],namespace:string):Promise<ReturnType<typeof materializeImagePage>>;
  materializeNotebookSemantic(notebookId:string, blocks:SemanticBlock[], title:string, pageId?:string):Promise<ReturnType<typeof materializeSemantic>>;
  materializeNotebookTranscription(notebookId:string,blocks:TranscriptionBlock[],regions:InkRegion[],sourceLines?:boolean):Promise<TranscriptionSheet[]>;
  bindNotebookMarkdown(notebookId:string,markdown:string,regions:InkRegion[],namespace?:string):Promise<{blocks:TranscriptionBlock[];sourceLines:boolean}>;
  projectSemantic: typeof projectSemantic;
  convertLegacyPage: typeof convertLegacyPage;
  templates: typeof NOTEBOOK_TEMPLATES;
  registerCustomTemplates(entries: unknown): {id:string;name:string;category:string}[];
  createTemplate(id: string, title: string): Promise<ReturnType<typeof createNotebookTemplate>>;
  /** Actual first-sheet layout at the current screen ratio, including Notes paper gutters. */
  previewTemplate(id: string): Promise<string>;
  exportDocumentPage(notebookId:string,pageId:string):Promise<string>;
  exportSavedDocumentPage(notebookId:string,pageId:string):Promise<string>;
  commitNotebookRevision<T>(notebookId:string,commit:()=>Promise<T>):Promise<T>;
  transcribeDocumentPage(notebookId:string,pageId:string):Promise<{text:string;inkIds:string[];error?:string}>;
  exportNotebookPages(notebookId: string): Promise<string[]>;
  getNotebookMarkdown(notebookId:string):Promise<string>;
  getNotebookSheets(notebookId: string): Promise<{source: string; sidecar: unknown}[]>;
  openNotebook(notebookId: string): void;
  /** Open only the ruled editing surface for a Notes-style planning notebook. */
  openWorkspaceNotebook(notebookId: string): void;
  attachmentContext(): {notebookId:string;pageId:string;owner:number} | null;
  addAttachment(context:{notebookId:string;pageId:string;owner:number},value:PageAttachment):Promise<void>;
  arrangeAttachments():void;
  updateAttachmentAudio(status:AudioStatus):void;
  isOpen(): boolean;
  hasOpenDialog(): boolean;
  close(save?: boolean): void;
  closeAndWait(save?: boolean): Promise<void>;
  finishWorkspace(): boolean;
  checkpointWorkspace(): Promise<void>;
  setDocumentDialog(active:boolean):Promise<void>;
  onPageKey(dir: -1 | 1): void;
  onPause(): void;
  onResume(): void;
  SAMPLES: ReadonlyArray<{ slug: string; title: string; markdown: string }>;
};

const ROOT_ID = "kalamos-write-workspace-root";

// Native ink is reserved for a display provider that explicitly retains its submitted panel frame
// (currently Bigme). Ordinary Android tablets already run this workspace as a website inside
// WebView, so they use the same pointer/canvas path as the browser build. Giving Standard Android
// native hooks would put an opaque SurfaceView over this DOM and force toolbar handoff machinery.
const IS_NATIVE = location.protocol === "file:";
const WORKSPACE_SOURCE_FILE = "planning.write2.md";
const WORKSPACE_SIDECAR_FILE = "planning.write2.json";
const BLANK_WORKSPACE_SOURCE = "\u200b";
const workspaceStore = createKalamosStore({
  sourceFile: WORKSPACE_SOURCE_FILE,
  sidecarFile: WORKSPACE_SIDECAR_FILE,
  preferencesKey: "notes.planning.write2.prefs",
  // Use the same model spacing for DOM, native snapshots and thumbnails. Saved preferences
  // remain authoritative so opening an existing note does not silently relocate its handwriting.
  defaultPreferences: { lineHeight: window.innerWidth <= 680 ? 56 : 44, penColor: "#000000" },
});

let app: VanillaApp | null = null;
let attachmentOwner = 0;
let openId: string | null = null;
let native: Write2Native | null = null;
let aiPanel: WriteAiPanel | null = null;
let lifecycleSequence = 0;
const backgroundSaves=new BackgroundSave();
let backgroundSaveError: string | null = null;
let sheets: WorkspacePages | null = null;
let switchingSheet = false;
let refreshingNotebook: string | null = null;
let revisionRefreshToken = 0;
let overflowSequence = 0;
function sheetStore(page: WorkspacePages['pages'][number]) {
  return createKalamosStore({ sourceFile: page.sourceFile, sidecarFile: page.sidecarFile,
    preferencesKey: "notes.planning.write2.prefs", defaultPreferences: { lineHeight: window.innerWidth <= 680 ? 56 : 44, penColor: "#000000" } });
}
function loadSheets(id: string) { return parsePages(readDocSource(id, PAGES_FILE)); }
async function changeSheet(action: -1 | 1 | 'add' | {index:number;force?:boolean}) {
  if (!app || !openId || !sheets || switchingSheet) return;
  const previousApp = app, id = openId, index = sheets;
  const keepZoom = !!root().querySelector(".magnify-pad");
  const next = action === 'add' ? appendPage(index, `p${Date.now().toString(36)}`)
    : { ...index, active: Math.max(0, Math.min(index.pages.length - 1, typeof action==='object'?action.index:index.active + action)) };
  if (next.active === index.active && !(typeof action==='object'&&action.force)) return;
  switchingSheet = true;
  try {
    await previousApp.checkpointWorkspace();
    if (app !== previousApp || openId !== id) return;
    if (action === 'add') {
      if (saveNotebookFile(id, next.pages[next.active].sourceFile, BLANK_WORKSPACE_SOURCE) !== 'ok') throw new Error('Cannot save new sheet');
      if (next.template && next.template !== 'ruled') {
        const prefs = await workspaceStore.loadPreferences();
        const title = kalamosStorage()?.loadMeta(id)?.title ?? 'Notebook';
        const starter = createNotebookTemplate(next.template, title, window.innerWidth, prefs.lineHeight, window.innerHeight);
        if (saveNotebookFile(id, next.pages[next.active].sidecarFile, JSON.stringify(starter.sidecar)) !== 'ok') throw new Error('Cannot save new sheet template');
      }
    }
    if (saveNotebookFile(id, PAGES_FILE, JSON.stringify(next)) !== 'ok') throw new Error('Cannot save page index');
    const storage = kalamosStorage();
    const nb = storage?.loadMeta(id);
    if (nb && storage && action === 'add') {
      nb.pages.push({pageId: next.pages[next.active].id, template: {type:'blank',spacing:0,margin:0}, strokes: []} as typeof nb.pages[number]);
      storage.saveNotebook(nb);
    }
    // Checkpoint drained the last pen batch; destroying retires this sheet's scoped owner.
    const toolbar = root().querySelector('.tool-pill');
    const toolbarMode = toolbar?.classList.contains('toolbar-all-tools') ? 'full' : toolbar?.classList.contains('toolbar-collapsed') ? 'collapsed' : 'compact';
    // Preserve the connected ink surface only AFTER checkpoint has saved the
    // departing sheet. Its pending pen batch must never reach the next sheet.
    // Write2Native validates geometry and falls back to a normal attach when
    // necessary; see the device-confirmed page-turn contract in the ink guide.
    native?.preparePageTurn();
    previousApp.destroy(); app = null; openId = null;
    openWorkspaceNotebook(id, toolbarMode, keepZoom);
    console.info(`[notes-pages] opened ${next.active + 1}/${next.pages.length}`);
  } catch (error) {
    native?.cancelPageTurn();
    console.warn('[notes-pages] switch failed', error);
  } finally { switchingSheet = false; }
}

/** Retire the saved model before external publication, then refresh this same note surface.
 * Reuses the existing sheet-turn controller retention, without routing through library/close. */
async function commitNotebookRevision<T>(notebookId:string,commit:()=>Promise<T>):Promise<T> {
  if(!app || openId!==notebookId || switchingSheet)throw Error('Keep this notebook open while applying its revision.');
  const previous=app,host=root(),token=++revisionRefreshToken;
  const toolbar=host.querySelector('.tool-pill');
  const toolbarMode=toolbar?.classList.contains('toolbar-all-tools')?'full':toolbar?.classList.contains('toolbar-collapsed')?'collapsed':'compact';
  const keepZoom=!!host.querySelector('.magnify-pad');
  const scrollTop=host.querySelector('.reflow-surface')?.scrollTop??0;
  switchingSheet=true;host.inert=true;
  try {
    await previous.checkpointWorkspace();
    if(app!==previous || openId!==notebookId)throw Error('The notebook was closed before its revision could be applied.');
    native?.preparePageTurn();
    const frozenMarkup=host.innerHTML,frozenClass=host.className;
    previous.destroy();app=null;openId=null;refreshingNotebook=notebookId;
    // Keep the last page visible in WebView too while the native transaction runs.
    // This inert markup has no model, listeners or autosave writer.
    host.innerHTML=frozenMarkup;host.className=frozenClass;
    try { return await commit(); }
    finally {
      // Commit failure reloads the saved original; success loads the newly published page.
      // Navigation during publication must never reopen a note the user deliberately left.
      if(token===revisionRefreshToken && !app) {
        refreshingNotebook=null;host.replaceChildren();
        await openWorkspaceNotebook(notebookId,toolbarMode,keepZoom,false);
        const paper=host.querySelector('.reflow-surface');if(paper)paper.scrollTop=scrollTop;
      }
    }
  } finally {refreshingNotebook=null;switchingSheet=false;host.inert=false;}
}

/** Render complete, real page content for the overview/cover; no daemon or toolbar capture. */
async function renderSavedPage(id:string,page:WorkspacePages['pages'][number],height?:number,thumbnail=false){
 const source=readDocSource(id,page.sourceFile)||BLANK_WORKSPACE_SOURCE;
 const sidecar=await sheetStore(page).loadSidecar(id),prefs=await workspaceStore.loadPreferences();
 const w=Math.max(1,window.innerWidth-24),h=height??Math.max(48,window.innerHeight-32);
 const host=document.createElement('div');host.style.cssText=`position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;pointer-events:none`;host.inert=true;document.body.append(host);
 let ws:PenWorkspace|undefined;
 try{
  ws=new PenWorkspace(host,{block:{id:'planning-document',type:'paragraph',sourceStart:0,sourceEnd:source.length,source,text:source},existingRuns:sidecar?.inkRuns??[],existingTextBoxes:sidecar?.textBoxes,existingPageObjects:sidecar?.pageObjects,loadAttachmentImage:window.KalamosWritingHost?.loadAttachmentImage,existingSourceWords:sidecar?.sourceWords,existingLineHeight:sidecar?.layoutLineHeight,prefs,eink:true,native:false,onCommit(){},onCancel(){}});
  await ws.readyAttachments();
  return {svg:ws.exportSvgPages({pageHeight:h,singlePage:true})[0],png:thumbnail?ws.renderThumbnailDataUrl():null};
 }finally{ws?.destroy();host.remove();}
}
function publishPageIndex(id:string,index:WorkspacePages){
 if(saveNotebookFile(id,PAGES_FILE,JSON.stringify(index))!=='ok')throw new Error('Cannot save page order');
 const storage=kalamosStorage(),nb=storage?.loadMeta(id);
 if(storage&&nb){const existing=new Map(nb.pages.map(p=>[p.pageId,p]));nb.pages=index.pages.map(p=>existing.get(p.id)??{pageId:p.id,strokes:[]});storage.saveNotebook(nb);}
 if(id===openId)sheets=index;
}
let overviewOpening=false;
async function openPageOverview(){
 if(!app||!openId||!sheets||switchingSheet||overviewOpening||root().querySelector('.rw-page-overview'))return;
 const id=openId,editor=app;
 overviewOpening=true;
 try {await editor.checkpointWorkspace();} catch(error){window.alert(error instanceof Error?error.message:String(error));return;} finally{overviewOpening=false;}
 if(app!==editor||openId!==id)return;
 native?.hooks().onWorkspaceDialog?.(true);
 let changed=false;
 const previews=new Map<string,Promise<string>>();
 showPageOverview(root(),{
  async load(){const index=loadSheets(id);return {active:index.active,pages:index.pages.map(p=>({id:p.id,cover:p.id===index.coverId})) };},
  preview(pageId){
   const index=loadSheets(id),page=index.pages.find(p=>p.id===pageId);
   if(!page)return Promise.reject(new Error('Page unavailable'));
   let promise=previews.get(pageId);
   if(!promise){promise=renderSavedPage(id,page,index.sheetHeight).then(p=>p.svg);previews.set(pageId,promise);}
   return promise;
  },
  destinations(){return (kalamosStorage()?.loadLibrary?.().notebooks??[]).filter(nb=>nb.notebookId!==id&&(!nb.kind||nb.kind==='planning')).map(nb=>({id:nb.notebookId,title:nb.title}));},
  async mutate(action:OverviewAction,ids:string[],value?:string){
   let index=loadSheets(id),target=id;
   if(action==='copyTo'){target=value??'';if(!kalamosStorage()?.loadMeta(target))throw new Error('Notebook unavailable');index=loadSheets(target);}
   const before=index;
   if(action==='copy'||action==='copyTo'){
    const originals=loadSheets(id).pages.filter(p=>ids.includes(p.id));
    if(!originals.length)throw new Error('Select pages first');
    for(const [n,p] of originals.entries()){
     const next=appendPage(index,`copy-${Date.now().toString(36)}-${n}`),dest=next.pages[next.active];
     for(const [file,content] of [[dest.sourceFile,readDocSource(id,p.sourceFile)||BLANK_WORKSPACE_SOURCE],[dest.sidecarFile,JSON.stringify(copySemanticBindings(JSON.parse(readDocSource(id,p.sidecarFile)||'{}'),()=>crypto.randomUUID()))]])if(saveNotebookFile(target,file,content)!=='ok')throw new Error('Cannot copy page');
     index={...next,active:before.active};
    }
   }else if(action==='delete')index=removePages(index,ids);
   else if(action==='cover'){if(ids.length!==1)throw new Error('Select one cover page');index={...index,coverId:ids[0]};}
   else {const selected=index.pages.map((p,n)=>ids.includes(p.id)?n:-1).filter(n=>n>=0);const at=action==='left'?Math.min(...selected)-1:action==='right'?Math.max(...selected)-selected.length+2:Number(value)-1;index=reorderPages(index,ids,at);}
   // Publish only after copied files exist. Removed files remain on disk;
   // do not delete source/sidecar files during a page-management transaction.
   // Retain the preceding manifest before changing membership/order. Source files are never
   // removed; this backup also preserves the index for manual recovery without an Undo control.
   if(saveNotebookFile(target,'planning.pages.previous.json',JSON.stringify(before))!=='ok')throw new Error('Cannot save page index backup');
   publishPageIndex(target,index);if(target===id)changed=true;
  },
  async open(index){native?.hooks().onWorkspaceDialog?.(false);if(app===editor && openId===id && (changed||index!==sheets?.active))await changeSheet({index,force:true});},
  async close(){native?.hooks().onWorkspaceDialog?.(false);if(changed&&app===editor&&openId===id)await changeSheet({index:loadSheets(id).active,force:true});}
 });
}

/** Spacing may push complete ruled rows beyond this sheet. Checkpoint first so deferred daemon
 * batches and transient spacers are materialised exactly once. Publication retains the old files;
 * a failed write leaves the editor and its fully saved original intact. Do not add a native clear,
 * full-screen refresh or attach delay here: this uses the accepted fast sheet-turn transaction. */
async function paginateCurrentSheet(height: number) {
  if (!app || !openId || !sheets || switchingSheet) return;
  const previousApp = app, id = openId, index = sheets;
  switchingSheet = true;
  try {
    await previousApp.checkpointWorkspace();
    if (app !== previousApp || openId !== id) return;
    const current = index.pages[index.active];
    const saved = validateSidecar(JSON.parse(readDocSource(id, current.sidecarFile)));
    if (!saved.ok) throw new Error('Cannot read saved sheet for pagination');
    const next = savePaginatedSheet(index, {source:readDocSource(id,current.sourceFile),sidecar:saved.sidecar},
      height, `overflow-${Date.now().toString(36)}-${overflowSequence++}`, (file,text) => saveNotebookFile(id,file,text));
    if (!next) return;
    // Compatibility metadata is best-effort; the manifest is already authoritative. A shelf
    // metadata failure must not leave the old editor writing into a retired sheet's files.
    try {
      const storage = kalamosStorage(), nb = storage?.loadMeta(id);
      if (storage && nb) {
        const existing = new Map(nb.pages.map(page => [page.pageId, page]));
        nb.pages = next.pages.map(page => existing.get(page.id) ??
          ({pageId:page.id,template:{type:'blank',spacing:0,margin:0},strokes:[]} as typeof nb.pages[number]));
        storage.saveNotebook(nb);
      }
    } catch (error) { console.warn('[notes-pages] compatibility metadata update failed', error); }
    const toolbar = root().querySelector('.tool-pill');
    const toolbarMode = toolbar?.classList.contains('toolbar-all-tools') ? 'full' : toolbar?.classList.contains('toolbar-collapsed') ? 'collapsed' : 'compact';
    native?.preparePageTurn();
    previousApp.destroy(); app = null; openId = null;
    openWorkspaceNotebook(id, toolbarMode);
    console.info(`[notes-pages] overflow added ${next.pages.length-index.pages.length} sheets; active ${next.active+1}/${next.pages.length}`);
  } catch (error) {
    native?.cancelPageTurn();
    console.warn('[notes-pages] pagination failed; original sheet retained', error);
  } finally { switchingSheet = false; }
}

function shouldUseNativeInk(): boolean {
  if (!IS_NATIVE || typeof Bridge === "undefined") return false;
  try {
    return typeof Bridge.supportsPersistentDisplayHandoff === "function" &&
      Bridge.supportsPersistentDisplayHandoff();
  } catch {
    // Bigme exposes this capability explicitly. A missing/broken capability therefore stays on the
    // simple WebView path instead of silently opting an ordinary Android tablet into SurfaceView.
    return false;
  }
}

function root(): HTMLElement {
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.style.display = "none";
    document.body.appendChild(el);
  }
  return el;
}

function enterSurface() {
  const lib = document.getElementById("library-view");
  if (lib) lib.style.display = "none";
  const ed = document.getElementById("editor-view");
  if (ed) ed.style.display = "none";
  const el = root();
  el.style.display = "block";
  if (typeof App !== "undefined") App.current = "app";
}

function exitSurface() {
  const el = root();
  el.style.display = "none";
  el.innerHTML = "";
  if (typeof App !== "undefined" && App.showLibrary) App.showLibrary();
}

function captureModelThumbnail(
  notebookId: string,
  renderer: VanillaApp,
  storage: ReturnType<typeof kalamosStorage>,
  done: () => void
): boolean {
  if (!storage?.saveRenderedThumbnail) return false;
  try {
    const dataUrl = renderer.renderWorkspaceThumbnail();
    if (!dataUrl || !storage.saveRenderedThumbnail(notebookId, dataUrl)) return false;
    done();
    return true;
  } catch {
    return false;
  }
}

/** Render saved files only: no daemon snapshots, layout refresh, attach, or hidden toolbar.
 * Capturing a signature before/after the async cover render rejects older previews. */
async function backgroundThumbnail(id:string){
 const index=loadSheets(id),page=index.pages.find(p=>p.id===index.coverId)??index.pages[index.active];
 const signature=()=>JSON.stringify([JSON.parse(readDocSource(id,PAGES_FILE)||'{}'),readDocSource(id,page.sourceFile),JSON.parse(readDocSource(id,page.sidecarFile)||'{}')],(key,value)=>key==='updatedAt'||key==='createdAt'?undefined:value);
 const before=signature();
 const {png}=await renderSavedPage(id,page,index.sheetHeight,true);
 return {signature:before,dataUrl:png,current:()=>signature()===before};
}

function openNotebook(notebookId: string) {
  sheets = null;
  if (openId) close(true);
  const source = readDocSource(notebookId);
  let title = "Untitled";
  try {
    const nb = kalamosStorage()?.loadMeta(notebookId);
    if (nb && nb.title) title = nb.title;
  } catch {
    // Title is cosmetic; keep the fallback.
  }
  enterSurface();
  if (shouldUseNativeInk() && !native) native = new Write2Native();
  app = createApp(root(), {
    store: kalamosStore,
    chrome: "kalamos",
    onExit: () => close(false), // createApp already saved before onExit
    onAiOpen: () => {
      if (!app) return;
      if (!aiPanel || !aiPanel.isOpen) {
        void app.saveNow().then(() => {
          aiPanel = new WriteAiPanel(app!);
          aiPanel.open();
        });
      } else {
        aiPanel.close();
      }
    },
    nativeHooks: native ? native.hooks() : undefined,
    hwr: kalamosHwr,
  });
  openId = notebookId;
  return app.openDocument({
    docId: notebookId,
    name: title,
    source,
    fingerprint: fingerprintOf(source),
    handle: null,
  });
}

function bindDocumentAction(action: DocumentAction<[string]>, notebookId: string): DocumentAction {
  return {...action,
    onPress: action.onPress ? () => action.onPress!(notebookId) : undefined,
    run: action.run ? () => action.run!(notebookId) : undefined,
    options: action.options?.map(option => bindDocumentAction(option, notebookId)),
  };
}

function openWorkspaceNotebook(notebookId: string, toolbarMode: "collapsed" | "compact" | "full" = "collapsed", keepZoom = false, notifyOpened = true) {
  attachmentOwner++;
  if(refreshingNotebook){revisionRefreshToken++;refreshingNotebook=null;root().replaceChildren();}
  if (openId) close(true);
  sheets = loadSheets(notebookId);
  const page = sheets.pages[sheets.active];
  traceInkOwner(notebookId, page.id, "opening");
  const source = readDocSource(notebookId, page.sourceFile) || BLANK_WORKSPACE_SOURCE;
  let title = "Planning";
  try {
    const nb = kalamosStorage()?.loadMeta(notebookId);
    if (nb && nb.title) title = nb.title;
  } catch {
    // Title is cosmetic; keep the fallback.
  }
  enterSurface();
  if (shouldUseNativeInk() && !native) native = new Write2Native();
  app = createApp(root(), {
    store: sheetStore(page),
    notebookToolbar: window.KalamosWritingHost?.notebookToolbar,
    loadAttachmentImage: attachment => {
      const load=window.KalamosWritingHost?.loadAttachmentImage;
      return load ? load(attachment) : Promise.reject(new Error('Image attachments are unavailable.'));
    },
    onActivateAttachment: object => window.KalamosWritingHost?.activateAttachment?.(object),
    onAttachmentError: message => window.KalamosWritingHost?.attachmentError?.(message),
    documentActions: window.KalamosWritingHost?.documentActions?.map(action => bindDocumentAction(action, notebookId)),
    pageTools: { overview: openPageOverview, index: sheets.active, count: sheets.pages.length, change: action => void changeSheet(action), overflow: height => void paginateCurrentSheet(height) },
    chrome: "kalamos",
    directWorkspace: true,
    onExit: () => close(false),
    nativeHooks: native ? native.hooks() : undefined,
    hwr: kalamosHwr,
  });
  openId = notebookId;
  return app.openDocument({
    docId: notebookId,
    name: title,
    source,
    fingerprint: fingerprintOf(source),
    handle: null,
  }).then(() => {
    if (openId !== notebookId) return;
    if(notifyOpened)window.KalamosWritingHost?.onDocumentOpened?.(notebookId);
    if (toolbarMode !== "collapsed") {
      root().querySelector<HTMLButtonElement>('[data-action="toolbar-toggle"]')?.click();
      if (toolbarMode === "full") root().querySelector<HTMLButtonElement>('[data-action="toolbar-expand"]')?.click();
    }
    // Restore Zoom on the destination sheet only after its own workspace/model has mounted.
    // The existing native geometry handoff rejects controller reuse for this mode.
    if (keepZoom) root().querySelector<HTMLButtonElement>('[data-action="magnify"]')?.click();
  }).catch(error => {
    native?.cancelPageTurn();
    console.warn('[notes-pages] sheet load failed', error);
    if(!notifyOpened)throw error;
  });
}

let closeComplete: Promise<void> = Promise.resolve();
function close(save = true) {
  attachmentOwner++;
  if(refreshingNotebook && !app) {
    const id=refreshingNotebook;refreshingNotebook=null;revisionRefreshToken++;
    native?.cancelPageTurn();native?.suspend();exitSurface();
    window.KalamosWritingHost?.onDocumentClosed?.(id);return;
  }
  if (!app) return;
  aiPanel?.close();
  aiPanel = null;
  let completed!: () => void;
  let failed!: (error: unknown) => void;
  closeComplete = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; });
  // Ordinary legacy callers intentionally do not await close. The explicit handoff API below
  // still receives the original rejection, while the existing UI reports a failed save.
  void closeComplete.catch(() => {});
  const a = app;
  const closingId = openId;
  if(closingId)backgroundSaves.invalidate(closingId);
  if (closingId) traceInkOwner(closingId, sheets?.pages[sheets.active]?.id ?? "", "closing");
  app = null;
  openId = null;
  const destroySurface = () => {
    try { a.destroy(); exitSurface(); }
    finally {
      try { if (closingId) window.KalamosWritingHost?.onDocumentClosed?.(closingId); }
      finally { completed(); }
    }
  };
  const finish = () => {
    const index=closingId?loadSheets(closingId):null;
    const cover=index?.pages.find(p=>p.id===index.coverId);
    if(closingId&&cover){
      void renderSavedPage(closingId,cover,index?.sheetHeight,true).then(({png})=>{if(png)kalamosStorage()?.saveRenderedThumbnail?.(closingId,png);}).catch(e=>console.warn('[notes-pages] cover capture failed',e)).finally(destroySurface);
      return;
    }
    // The flushed model is authoritative on every provider. Use one writer: a native
    // background PNG must never race and overwrite this completed vector preview.
    if (closingId && captureModelThumbnail(closingId, a, kalamosStorage(), destroySurface)) {
      console.info('[notes-thumbnail] model saved before shelf return');
      return;
    }
    console.warn('[notes-thumbnail] model preview unavailable; retained previous thumbnail');
    destroySurface();
  };
  if (save) void a.checkpointWorkspace().then(finish, error => {
    console.warn('[notes-save] close save failed', error);
    if (!app) { app = a; openId = closingId; }
    failed(error);
    window.alert('Notebook could not be saved. Your page is still open; please try again.');
  });
  else finish();
}

let customTemplates = parseCustomNotebookTemplates([]);
function customStarter(id:string,title:string) {
  const template=customTemplates.find(t=>t.id===id);
  if (!template) return null;
  const sidecar=JSON.parse(JSON.stringify(template.sidecar));
  sidecar.documentName=title;
  return {source:template.source,sidecar,template:"ruled" as const};
}

const api: KalamosWriteWorkspaceApi = {
  registerCustomTemplates(entries) { customTemplates=parseCustomNotebookTemplates(entries); return customTemplates.map(({id,name,category})=>({id,name,category})); },
  materializeSemantic, projectSemantic,
  async createMarkdownSheets(markdown,title) {
    const prefs=await workspaceStore.loadPreferences();
    const lineHeight=resolveRuledLineHeight(undefined,undefined,prefs.lineHeight);
    const width=Math.max(240,window.innerWidth-24),height=Math.max(lineHeight*2,window.innerHeight-64);
    return materializeSemantic(markdownImportBlocks(markdown,Math.max(24,Math.floor((width-32)/(lineHeight*.65*.62)))),title,width,height,lineHeight,{paperWidth:width,paperHeight:height});
  },
  async materializeNotebookImage(notebookId,pageId,markdown,regions,namespace){
    if(openId===notebookId&&app)await app.checkpointWorkspace();
    const index=loadSheets(notebookId),page=index.pages.find(page=>page.id===pageId);
    if(!page)throw Error('Original page is unavailable.');
    const [sidecar,prefs]=await Promise.all([sheetStore(page).loadSidecar(notebookId),workspaceStore.loadPreferences()]);
    if(!sidecar)throw Error('Saved page is unavailable.');
    const paper=openId===notebookId?document.getElementById(ROOT_ID)?.querySelector<HTMLElement>('.reflow-surface'):null;
    const lineHeight=resolveRuledLineHeight(sidecar.layoutLineHeight,sidecar.sourceWords,prefs.lineHeight);
    return materializeImagePage(markdown,readDocSource(notebookId,page.sourceFile),sidecar,regions,'Formatted page',paper?.clientWidth||Math.max(240,window.innerWidth-24),index.sheetHeight||paper?.clientHeight||Math.max(lineHeight*2,window.innerHeight-64),lineHeight,namespace);
  },
  async bindNotebookMarkdown(notebookId,markdown,regions,namespace){
    if(openId===notebookId&&app)await app.checkpointWorkspace();
    const index=loadSheets(notebookId),page=index.pages.find(p=>p.id===regions[0]?.pageId);
    if(!page)throw Error('Original notebook page is unavailable.');
    const [sidecar,prefs]=await Promise.all([sheetStore(page).loadSidecar(notebookId),workspaceStore.loadPreferences()]);
    if(!sidecar)throw Error('Saved handwriting is unavailable.');
    const result=bindMarkdownResultToInk(markdown,regions,resolveRuledLineHeight(sidecar.layoutLineHeight,sidecar.sourceWords,prefs.lineHeight));
    const blocks=result.blocks;
    if(!namespace)return result;
    if(!/^[A-Za-z0-9_-]{1,60}$/.test(namespace))throw Error('Invalid Markdown result identity.');
    const ids=new Map(blocks.map(block=>[block.id,`${namespace}-${block.id}`]));
    return {...result,blocks:blocks.map(block=>({...block,id:ids.get(block.id)!,...(block.parentId?{parentId:ids.get(block.parentId)!}:{})}))};
  },
  async materializeNotebookTranscription(notebookId,blocks,regions,sourceLines=false){
    if(openId===notebookId&&app)await app.checkpointWorkspace();
    const index=loadSheets(notebookId),prefs=await workspaceStore.loadPreferences();
    const byId=new Map(regions.map(r=>[r.id,r]));
    if(byId.size!==regions.length)throw new Error('Duplicate handwriting region.');
    const perPage=new Map<string,TranscriptionBlock[]>();
    for(const block of blocks){
      if(!block.sourceInkRegionIds?.length)throw new Error('Transcription needs handwriting references.');
      const pages=new Set(block.sourceInkRegionIds.map(id=>{const region=byId.get(id);if(!region)throw new Error('Unknown handwriting region.');return region.pageId;}));
      if(pages.size!==1)throw new Error('Return separate transcription blocks for each page.');
      const pageId=[...pages][0];if(!perPage.has(pageId))perPage.set(pageId,[]);perPage.get(pageId)!.push(block);
    }
    const paper=openId===notebookId?document.getElementById(ROOT_ID)?.querySelector<HTMLElement>('.reflow-surface'):null;
    const result:TranscriptionSheet[]=[];
    for(const [pageId,pageBlocks] of perPage){
      const page=index.pages.find(p=>p.id===pageId);if(!page)throw new Error('Notebook page is unavailable.');
      const sidecar=await sheetStore(page).loadSidecar(notebookId);if(!sidecar)throw new Error('Saved handwriting is unavailable.');
      const lineHeight=resolveRuledLineHeight(sidecar.layoutLineHeight,sidecar.sourceWords,prefs.lineHeight);
      result.push(materializeTranscriptionPage({pageId,source:readDocSource(notebookId,page.sourceFile),sidecar},pageBlocks,regions,{lineHeight,sourceLines,width:paper?.clientWidth||Math.max(240,window.innerWidth-24),height:index.sheetHeight||paper?.clientHeight||Math.max(lineHeight*2,window.innerHeight-64)}));
    }
    if(!result.length)throw new Error('No transcription was returned.');
    return result;
  },
  async materializeNotebookSemantic(notebookId,blocks,title,pageId){
    if(openId===notebookId && app)await app.checkpointWorkspace();
    const index=loadSheets(notebookId);
    const page=pageId?index.pages.find(p=>p.id===pageId):index.pages[index.active];
    if(!page)throw new Error('Notebook page is unavailable');
    const [sidecar,prefs]=await Promise.all([sheetStore(page).loadSidecar(notebookId),workspaceStore.loadPreferences()]);
    const lineHeight=resolveRuledLineHeight(sidecar?.layoutLineHeight,sidecar?.sourceWords,prefs.lineHeight);
    const paper=openId===notebookId?document.getElementById(ROOT_ID)?.querySelector<HTMLElement>('.reflow-surface'):null;
    const width=paper?.clientWidth||Math.max(240,window.innerWidth-24);
    const height=index.sheetHeight||paper?.clientHeight||Math.max(lineHeight*2,window.innerHeight-64);
    return materializeSemantic(blocks,title,width,height,lineHeight,{paperWidth:width,paperHeight:height});
  },
  convertLegacyPage,
  templates: NOTEBOOK_TEMPLATES,
  async createTemplate(id, title) {
    const prefs = await workspaceStore.loadPreferences();
    return customStarter(id,title) ?? createNotebookTemplate(id, title, window.innerWidth, prefs.lineHeight, window.innerHeight);
  },
  async previewTemplate(id) {
    const prefs = await workspaceStore.loadPreferences();
    const screenWidth = window.innerWidth, screenHeight = window.innerHeight;
    const width = Math.max(1, screenWidth - 24), height = Math.max(1, screenHeight - 32);
    const starter = customStarter(id,'Notebook') ?? createNotebookTemplate(id, 'Notebook', screenWidth, prefs.lineHeight, screenHeight);
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;padding:0;pointer-events:none`;
    host.setAttribute('aria-hidden', 'true'); host.inert = true;
    document.body.append(host);
    // An isolated export workspace shares template/model/layout/checkbox/font code with the live
    // editor. Never attach native ink or crop to content here: users need the whole visible sheet,
    // not a symbolic drawing or a thumbnail zoomed into its first heading.
    let workspace: PenWorkspace | undefined;
    try {
      workspace = new PenWorkspace(host, {block:{id:'planning-document',type:'paragraph',sourceStart:0,sourceEnd:starter.source.length,source:starter.source,text:starter.source},
        existingRuns:starter.sidecar.inkRuns,existingSourceWords:starter.sidecar.sourceWords,existingTextBoxes:starter.sidecar.textBoxes,existingPageObjects:starter.sidecar.pageObjects,
        existingLineHeight:starter.sidecar.layoutLineHeight,prefs,eink:true,native:false,onCommit(){},onCancel(){}});
      const paper = workspace.exportSvgPages({pageHeight:height,singlePage:true})[0];
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${screenWidth} ${screenHeight}" width="${screenWidth}" height="${screenHeight}"><rect width="100%" height="100%" fill="#fff"/><svg x="12" y="12" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paper}</svg></svg>`;
    } finally { workspace?.destroy(); host.remove(); }
  },
  async getNotebookMarkdown(notebookId) {
    if(openId===notebookId)await app?.checkpointWorkspace();
    const index=loadSheets(notebookId);
    const sheets=await Promise.all(index.pages.map(async page=>({source:readDocSource(notebookId,page.sourceFile),sidecar:await sheetStore(page).loadSidecar(notebookId)})));
    return notebookSheetsToMarkdown(sheets);
  },
  async getNotebookSheets(notebookId) {
    if (openId === notebookId) await app?.checkpointWorkspace();
    const index = loadSheets(notebookId);
    return Promise.all(index.pages.map(async page => ({
      source: readDocSource(notebookId, page.sourceFile) || BLANK_WORKSPACE_SOURCE,
      sidecar: await sheetStore(page).loadSidecar(notebookId),
    })));
  },
  commitNotebookRevision,
  async exportSavedDocumentPage(notebookId,pageId) {
    const index=loadSheets(notebookId),page=index.pages.find(p=>p.id===pageId);
    if(!page)throw new Error('Page unavailable');
    return (await renderSavedPage(notebookId,page,index.sheetHeight)).svg;
  },
  async exportDocumentPage(notebookId,pageId) {
    if(openId===notebookId)await app?.checkpointWorkspace();
    const index=loadSheets(notebookId),page=index.pages.find(p=>p.id===pageId);
    if(!page)throw new Error('Page unavailable');
    return (await renderSavedPage(notebookId,page,index.sheetHeight)).svg;
  },
  async transcribeDocumentPage(notebookId,pageId) {
    if(openId===notebookId)await app?.checkpointWorkspace();
    const page=loadSheets(notebookId).pages.find(p=>p.id===pageId);if(!page)throw new Error('Page unavailable');
    const sidecar=await sheetStore(page).loadSidecar(notebookId);
    const runs=sidecar?.inkRuns??[];
    if(!runs.length)return {text:'',inkIds:[]};
    if(!kalamosHwr.available())return {text:'',inkIds:runs.map(r=>r.id),error:'Local handwriting recognition is unavailable. Include page images for a vision model.'};
    const strokes=runs.flatMap(r=>r.strokes.map(s=>s.points.map(p=>[p.x+(r.layoutX??0),p.y+(r.layoutY??0),p.pressure])));
    return new Promise(resolve=>{
      const timer=window.setTimeout(()=>resolve({text:'',inkIds:runs.map(r=>r.id),error:'Recognition timed out; original ink is unchanged.'}),20000);
      kalamosHwr.recognize(strokes,{w:window.innerWidth,h:loadSheets(notebookId).sheetHeight??window.innerHeight},'',result=>{
        window.clearTimeout(timer);resolve({text:result.text??'',inkIds:runs.map(r=>r.id),...(result.error?{error:result.error}:{})});
      });
    });
  },
  async exportNotebookPages(notebookId) {
    if (openId === notebookId) await app?.checkpointWorkspace();
    const index = loadSheets(notebookId);
    const prefs = await workspaceStore.loadPreferences();
    const pages: string[] = [];
    for (const page of index.pages) {
      const source = readDocSource(notebookId, page.sourceFile) || BLANK_WORKSPACE_SOURCE;
      const sidecar = await sheetStore(page).loadSidecar(notebookId);
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-10000px;top:0;width:572px;height:772px";
      document.body.append(host);
      try {
        const ws = new PenWorkspace(host, { block:{id:"planning-document",type:"paragraph",sourceStart:0,sourceEnd:source.length,source,text:source}, existingRuns:sidecar?.inkRuns ?? [], existingTextBoxes:sidecar?.textBoxes, existingPageObjects:sidecar?.pageObjects,loadAttachmentImage:window.KalamosWritingHost?.loadAttachmentImage, existingSourceWords:sidecar?.sourceWords, existingLineHeight:sidecar?.layoutLineHeight, prefs, eink:true, native:false, onCommit:()=>{}, onCancel:()=>{} });
        await ws.readyAttachments();
        pages.push(...ws.exportSvgPages()); ws.destroy();
      } finally { host.remove(); }
    }
    return pages;
  },
  openNotebook,
  openWorkspaceNotebook,
  attachmentContext: () => openId && sheets ? {notebookId:openId,pageId:sheets.pages[sheets.active].id,owner:attachmentOwner} : null,
  async addAttachment(context,value) {
    if(!app || context.owner!==attachmentOwner || openId!==context.notebookId || sheets?.pages[sheets.active].id!==context.pageId)
      throw new Error('The page changed. Open Attach again on the intended page.');
    await app.addAttachment(value);
  },
  arrangeAttachments: () => app?.arrangeAttachments(),
  updateAttachmentAudio: status => app?.updateAttachmentAudio(status),
  isOpen: () => app !== null || refreshingNotebook !== null,
  hasOpenDialog: () => !!document.getElementById(ROOT_ID)?.querySelector('[role="dialog"]') || !!document.querySelector('[data-writing-document-dialog]'),
  close,
  closeAndWait: (save = true) => { close(save); return closeComplete; },
  finishWorkspace: () => {
    const overview=document.getElementById(ROOT_ID)?.querySelector('.rw-page-overview');
    if(overview){overview.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;}
    return app?.finishWorkspace()??false;
  },
  checkpointWorkspace: () => app?.checkpointWorkspace() ?? Promise.resolve(),
  async setDocumentDialog(active) { if(active)await app?.checkpointWorkspace();native?.hooks().onWorkspaceDialog?.(active); },
  onPageKey(dir) {
    if(document.querySelector('[data-writing-document-dialog]'))return;
    const overview=document.getElementById(ROOT_ID)?.querySelector('.rw-page-overview');
    if(overview){overview.querySelector<HTMLButtonElement>(`[aria-label="${dir<0?'Previous':'Next'} overview page"]`)?.click();return;}
    if (!app) return;
    if (app.isEditing()) { if (sheets) void changeSheet(dir); return; }
    app.pageBy(dir);
  },
  onPause() {
    const pausedApp = app, id=openId;
    const sequence = ++lifecycleSequence;
    if (!pausedApp) {
      native?.suspend();
      return;
    }
    if(!id)return;
    // Preserve existing ordered flush/save → scoped suspend. Preview generation
    // reads saved vectors afterward and never captures or repaints the daemon.
    void backgroundSaves.run(pausedApp,id,()=>pausedApp.checkpointWorkspace(),()=>{
      if (app === pausedApp && lifecycleSequence === sequence) native?.suspend();
    },()=>backgroundThumbnail(id),data=>kalamosStorage()?.saveRenderedThumbnail?.(id,data)===true)
      .then(()=>console.info('[notes-background-save] checkpoint and preview complete'))
      .catch(error=>{backgroundSaveError=error instanceof Error?error.message:String(error);console.warn('[notes-background-save]',error);});
  },
  onResume() {
    lifecycleSequence++;
    native?.resume();
    if(backgroundSaveError){const message=backgroundSaveError;backgroundSaveError=null;if(typeof Bridge!=='undefined'&&typeof Bridge.showToast==='function')Bridge.showToast(message+'. Close the notebook again to retry saving.');}
  },
  SAMPLES: [
    { slug: "welcome", title: "Welcome to Write", markdown: SAMPLE_DOC },
    { slug: "guide", title: "Pen tools guide", markdown: GUIDE_DOC },
  ],
};

window.KalamosWriteWorkspace = api;
