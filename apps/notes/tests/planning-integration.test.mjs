// Guard the architectural seam that previously allowed the retired Planning renderer, template
// state and native ink owner to overlap. These checks are intentionally source-level: they fail
// before an APK can be built with a second Planning implementation hidden behind the shared editor.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const notesRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(notesRoot, '../..')
const webRoot = join(notesRoot, 'app/src/main/assets/web')
const overlay = readFileSync(join(webRoot, 'js/app-overlay.js'), 'utf8')
const overlayCss = readFileSync(join(webRoot, 'css/app-overlay.css'), 'utf8') + readFileSync(join(repoRoot, 'features/writing/workspace/src/kalamos/notes-writing-ui.css'), 'utf8')
const editorController = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/assets/web/js/editor-controller.js'),
  'utf8'
)
const inkTools = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/assets/web/js/ink-tools.js'),
  'utf8'
)

test('classic Zoom scales placement coordinates while preserving pen thickness', () => {
  const window = { devicePixelRatio: 2 }
  runInNewContext(inkTools, { window, document: { createElement: () => ({}), head: { appendChild() {} } } })
  const pad = window.InkTools.WritingPad
  for (const magnification of [2, 2.5, 3]) {
    const stroke = { color: '#000000', width: 4.5, points: [{ x: 84, y: 108, p: .5 }, { x: 124, y: 128, p: .8 }] }
    const mapped = pad._mapZoomStroke.call({ _cv: { width: 800, height: 400 }, _focus: { x: 100, y: 200 }, _magnification: magnification }, stroke)
    assert.equal(mapped.width, stroke.width)
    assert.equal(mapped.color, stroke.color)
    assert.equal(mapped.points[0].x, 100)
    assert.equal(mapped.points[0].y, 200)
    assert.ok(Math.abs(mapped.points[1].x - mapped.points[0].x - 40 / magnification) < 1e-10)
    assert.equal(mapped.points[1].p, .8)
    assert.equal(stroke.points[1].x, 124)
  }
})
const writingEntry = readFileSync(
  join(repoRoot, 'features/writing/workspace/src/kalamos/entry.ts'),
  'utf8'
)
const writingNative = readFileSync(
  join(repoRoot, 'features/writing/workspace/src/kalamos/native.ts'),
  'utf8'
)
const writingStore = readFileSync(
  join(repoRoot, 'features/writing/workspace/src/kalamos/kalamosStore.ts'),
  'utf8'
)
const inkManager = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/java/com/kalamos/notebook/bridge/InkManager.kt'),
  'utf8'
)
const inkSurface = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/java/com/kalamos/notebook/view/InkSurfaceView.kt'),
  'utf8'
)

test('cold heavy handwriting pages present complete ink in one request', () => {
  const strokes=Array.from({length:80},()=>({width:2,color:'#000000',points:Array.from({length:30},(_,i)=>({x:i,y:30}))}))
  const raw=JSON.stringify(strokes)
  assert.ok(raw.length>18000)
  const page={strokes:null,template:{type:'lined',spacing:44,margin:20},pageId:'p1'}
  const presented=[]
  const context={currentPage:()=>page,editorWebInputActive:false,needsStandardEditorHandoff:()=>false,
    window:{devicePixelRatio:2},Storage:{loadPageRaw:()=>raw,parseStrokes:JSON.parse},notebook:{notebookId:'qa'},
    paper:{getBoundingClientRect:()=>({left:0,top:0,right:500,bottom:700})},inkSurfaceOriginX:0,inkSurfaceOriginY:0,
    inkCssBounds:{left:0,top:0},Bridge:{renderInk:json=>presented.push(JSON.parse(json))},
    schedulePrefetch(){},scheduleEvict(){},setTimeout(){throw new Error('Page ink must not be deferred')}}
  const method=editorController.slice(editorController.indexOf('function syncNativePage('),editorController.indexOf('// Interactive-format pages:'))
  runInNewContext(method+';syncNativePage()',context)
  assert.equal(presented.length,1)
  assert.equal(presented[0].s.length,80)
  assert.equal(page.strokes.length,80)
})

test('retiring floating chrome is ordered with captures and does not present or clear document ink', () => {
  const retire = inkManager.slice(inkManager.indexOf('    fun clearMenuSnapshot()'), inkManager.indexOf('    /** Capture the floating menu'))
  assert.match(retire, /mainHandler\.post/)
  assert.match(retire, /enqueueCapture\(0L\) \{ inkSurfaceView\.clearMenuSnapshot\(\) \}/)
  const model = inkSurface.slice(inkSurface.indexOf('    fun clearMenuSnapshot()'), inkSurface.indexOf('    /** The floating collapsible menu:'))
  assert.match(model, /menuBitmap = null/)
  assert.doesNotMatch(model, /commitPage|syncOverlay|invalidate|recycle|contentBitmap|strokes|inkController/)
})

test('native page composition presents ink and foreground chrome together', () => {
  const compose=inkSurface.slice(inkSurface.indexOf('    private fun renderFromState('),inkSurface.indexOf('    private fun drawDisplayedStrokes('))
  assert.ok(compose.indexOf('drawDisplayedStrokes(c)')<compose.indexOf('commitPage(refreshRect)'))
  assert.ok(compose.indexOf('drawChrome(c)')<compose.indexOf('commitPage(refreshRect)'))
  assert.doesNotMatch(compose,/post\(|shellFirst/)
  assert.match(compose,/refreshRect \?: paperRegion\(\)/)
})
const bigmeController = readFileSync(
  join(repoRoot, 'devices/bigme/src/main/java/com/kalamos/device/bigme/BigmeInkController.kt'),
  'utf8'
)
const storageWeb = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/assets/web/js/storage-web.js'),
  'utf8'
)
const storageManager = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/java/com/kalamos/notebook/storage/StorageManager.kt'),
  'utf8'
)
const storageModels = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/java/com/kalamos/notebook/storage/Models.kt'),
  'utf8'
)
const bridgeWeb = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/assets/web/js/bridge.js'),
  'utf8'
)
const runtimeApp = readFileSync(
  join(repoRoot, 'foundation/android-runtime/src/main/assets/web/js/app.js'),
  'utf8'
)

function productionText(root) {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name)
    if (statSync(path).isDirectory()) return productionText(path)
    return /\.(?:html|css|js|json)$/.test(name) ? [readFileSync(path, 'utf8')] : []
  }).join('\n')
}

test('Planning has no app-owned legacy implementation file', () => {
  assert.equal(existsSync(join(webRoot, 'js/planning.js')), false)
  assert.equal(existsSync(join(webRoot, 'gesture-lab.html')), false)
})

test('Planning routes creation and reopen through the shared writing feature', () => {
  assert.match(overlay, /window\.KalamosWriteWorkspace/)
  assert.match(overlay, /editor\.openWorkspaceNotebook\(nb\.notebookId\)/)
  assert.match(overlay, /editor\.openWorkspaceNotebook\(id\)/)
})

test('Notes chrome mounts after the shared library shell exists', () => {
  assert.match(overlay, /appHooks\.onLibraryReady\s*=\s*buildLibraryChrome/)
  assert.match(overlay, /notesChromeMounted/)
  assert.match(runtimeApp, /hooks\.onLibraryReady\(\)/)
  assert.ok(
    runtimeApp.indexOf('initLibrary()') < runtimeApp.indexOf('hooks.onLibraryReady()'),
    'the app hook must run after initLibrary creates #header',
  )
})

test('Planning source stays with notebook metadata and cannot create a masking book record', () => {
  assert.match(writingStore, /Bridge\.getNotebookFile/)
  assert.match(writingStore, /Bridge\.saveNotebookFile/)
  assert.match(bridgeWeb, /getNotebookFile\(notebookId,\s*relPath\)/)
  assert.match(bridgeWeb, /saveNotebookFile\(notebookId,\s*relPath,\s*content\)/)
  assert.match(
    storageManager,
    /private fun recordDir\(id: String\)[\s\S]*if\s*\(hasBookPayload\(canonical\)\)\s*canonical\s*else\s*notebookDir\(id\)/
  )
  assert.match(storageManager, /fun getNotebookFile\(notebookId: String,\s*relPath: String\)/)
  assert.match(storageManager, /fun saveNotebookFile\(notebookId: String,\s*relPath: String,\s*content: String\)/)
})

test('native notebook round-trips preserve the optional Planning discriminator', () => {
  assert.match(storageModels, /val kind:\s*String\?\s*=\s*null/)
  assert.match(storageModels, /kind\?\.let\s*\{\s*put\("kind",\s*it\)\s*\}/)
  assert.match(storageModels, /kind\s*=\s*obj\.optString\("kind"\)\.takeIf/)
  assert.match(storageManager, /if\s*\(meta\.has\("kind"\)\)\s*sb\.append\(",\\"kind\\":"\)/)
  assert.match(storageManager, /nb\.kind\?\.let\s*\{\s*put\("kind",\s*it\)\s*\}/)
})

test('Planning compatibility page is blank and cannot inherit a handwriting template', () => {
  assert.match(overlay, /blankCompatibilityTemplate\s*=\s*\{\s*type:\s*'blank'/)
  assert.doesNotMatch(overlay, /data-mode="handwriting"|createNewNotebook\(|buildEditorChrome\(/)
  assert.match(runtimeApp, /AppMode\.openNotebook\(notebookId\)/)

})

test('Planning owns lifecycle through its scoped workspace editor', () => {
  assert.match(overlay, /editor\.finishWorkspace\(\)/)
  assert.match(overlay, /editor\.onPause\(\)/)
  assert.match(overlay, /editor\.onResume\(\)/)
  assert.match(writingEntry, /backgroundSaves\.run\(pausedApp,id,\(\)=>pausedApp\.checkpointWorkspace\(\)/)
  assert.match(writingEntry, /lifecycleSequence === sequence\) native\?\.suspend\(\)/)
  assert.match(writingEntry, /if \(save\) void a\.checkpointWorkspace\(\)\.then\(finish, error =>/)
  assert.doesNotMatch(runtimeApp, /window\.saveNotebook\(\); detachInk\(\)/)
  assert.match(runtimeApp, /detachInk owns the ordered native flush/)
})

test('Planning saves model thumbnails without native capture or toolbar hiding', () => {
  assert.match(writingEntry, /captureModelThumbnail\(closingId,\s*a,\s*kalamosStorage\(\),\s*destroySurface\)/)
  assert.match(writingEntry, /renderer\.renderWorkspaceThumbnail\(\)/)
  assert.match(writingEntry, /storage\.saveRenderedThumbnail\(notebookId,\s*dataUrl\)/)
  assert.doesNotMatch(writingEntry, /captureWebThumbnail|captureAndDestroy|prepareThumbnailCapture|storage\.saveThumbnail\(/)
  assert.doesNotMatch(writingNative, /prepareThumbnailCapture|toolbar\.style\.visibility/)
})

test('thumbnail downscaling preserves thin rules and handwriting', () => {
  assert.match(inkSurface, /Paint\.FILTER_BITMAP_FLAG/)
  assert.match(inkSurface, /Paint\.DITHER_FLAG/)
  assert.match(inkSurface, /RectF\(dx,\s*dy,\s*dx\s*\+\s*dw,\s*dy\s*\+\s*dh\)/)
  assert.match(inkManager, /fun saveWebThumbnail\(/)
  assert.match(inkManager, /private fun scaleWebThumbnail\(/)
  assert.match(inkManager, /android\.graphics\.Paint\.FILTER_BITMAP_FLAG/)
  assert.match(storageManager, /fun saveThumbnailBytes[\s\S]*return atomicWrite\(/)
  assert.match(writingEntry, /captureModelThumbnail/)
  const penWorkspace = readFileSync(
    join(repoRoot, 'features/writing/workspace/src/vanilla/penWorkspace.ts'),
    'utf8'
  )
  assert.match(penWorkspace, /renderThumbnailDataUrl\(/)
  assert.match(penWorkspace, /const strokes = this\.getNativeInkStrokes\(\)/)
  assert.match(penWorkspace, /fillStroke\([\s\S]*stroke\.width,[\s\S]*stroke\.color/)
  assert.doesNotMatch(penWorkspace, /Math\.max\(stroke\.width, 3 \/ scale\)/)
  assert.match(penWorkspace, /export function thumbnailCrop\(/)
  assert.match(penWorkspace, /const crop = thumbnailCrop\(/)
})

test('classic Handwriting thumbnails flush and render the complete model before capture', () => {
  assert.match(editorController, /flushNativeThen\(captureAuthoritativePage\)/)
  assert.match(
    editorController,
    /ensurePageLoaded\(currentPageIndex\)[\s\S]*window\.saveNotebook\(\)[\s\S]*syncNativePage\(\)[\s\S]*Storage\.saveThumbnail\(notebook\.notebookId,\s*finishDetach\)/
  )
  assert.match(editorController, /function captureStandardWebThumbnail\(/)
  assert.match(
    editorController,
    /if\s*\(captureStandardWebThumbnail\(notebook\.notebookId,\s*finishDetach\)\)\s*return/
  )
  assert.match(editorController, /targetWidth = 320[\s\S]*targetHeight = Math\.round\(targetWidth \* 131 \/ 86\)/)
  assert.match(editorController, /scaleX = targetWidth \/ pageWidth[\s\S]*scaleY = targetHeight \/ pageHeight/)
  assert.doesNotMatch(editorController, /offsetX = \(targetWidth - pageWidth \* scale\) \/ 2/)
  assert.match(editorController, /template\.type === 'ruled'[\s\S]*for \(const stroke of page\.strokes\)/)
  assert.match(editorController, /Math\.max\(stroke\.width \|\| 1,\s*1 \/ minScale\)/)
  assert.match(editorController, /Storage\.saveRenderedThumbnail\(notebookId,\s*canvas\.toDataURL\('image\/png'\)\)/)
  assert.doesNotMatch(
    editorController,
    /function captureStandardWebThumbnail[\s\S]{0,700}requestAnimationFrame/
  )
  assert.match(storageWeb, /saveRenderedThumbnail\(notebookId,\s*dataUrl\)/)
  assert.match(bridgeWeb, /saveThumbnailDataUrl\(notebookId,\s*dataUrl\)/)
})

test('a new native editor attach restores stylus dispatch after thumbnail exit disabled the view', () => {
  assert.match(
    inkSurface,
    /fun attach\([\s\S]*super\.setEnabled\(true\)[\s\S]*inkController\s*=\s*controller/
  )
})

test('Planning shares the drawing editor monochrome icon registry with the writing toolbar', () => {
  assert.match(overlay, /window\.KalamosToolbarIcons\.svg/)
  const shell = readFileSync(join(repoRoot, 'foundation/android-runtime/src/main/assets/web/app.html'), 'utf8')
  assert.match(shell, /js\/toolbar-icons\.js/)
  const sharedIcons = readFileSync(join(repoRoot, 'foundation/android-runtime/src/main/assets/web/js/toolbar-icons.js'), 'utf8')
  assert.match(sharedIcons, /template:/)
  assert.match(sharedIcons, /spaceHorizontal:/)
  assert.match(sharedIcons, /delete:/)
  assert.match(sharedIcons, /magnify:/)
})

test('Planning direct mode hides the notebook header and offers compact-to-full tools', () => {
  const writingCss = readFileSync(
    join(repoRoot, 'features/writing/workspace/src/vanilla/eink.css'),
    'utf8'
  )
  const penWorkspace = readFileSync(
    join(repoRoot, 'features/writing/workspace/src/vanilla/penWorkspace.ts'),
    'utf8'
  )
  assert.match(writingCss, /\.vanilla-app\.direct-workspace \.v-modal-header\s*\{\s*display:\s*none/)
  assert.match(writingCss, /\.tool-pill:not\(\.toolbar-all-tools\) \.toolbar-more\s*\{\s*display:\s*none/)
  assert.match(
    writingCss,
    /\.pen-workspace\.magnify-open \.tool-pill:not\(\.toolbar-all-tools\)\s*\{\s*display:\s*none/
  )
  assert.match(penWorkspace, /classList\.toggle\("toolbar-all-tools"\)/)
  assert.match(penWorkspace, /"toolbar-expand"/)
  assert.match(
    overlayCss,
    /\.tool-pill:not\(\.toolbar-all-tools\) \.toolbar-history[\s\S]*display:\s*flex/
  )
  assert.match(
    overlayCss,
    /\.tool-pill:not\(\.toolbar-all-tools\) > \.toolbar-more-rail\s*\{[\s\S]*display:\s*flex/
  )
  assert.match(overlayCss, /\.tool-pill\.toolbar-all-tools > \.toolbar-more-rail[\s\S]*position:\s*fixed/)
  assert.match(
    overlayCss,
    /body\.magnify-active #kalamos-write-workspace-root \.tool-pill\.toolbar-all-tools > \.toolbar-more-rail\s*\{[\s\S]*bottom:\s*34vh/
  )
  assert.match(overlayCss, /\.v-modal\.toolbar-mode-full > \.v-modal-header[\s\S]*height:\s*48px/)
})

test('unified Notes toolbar retains compact and expanded ruled controls', () => {
  assert.doesNotMatch(overlay, /installFloatingToolbarDrag|KalamosEditorLiveChrome/)
  assert.match(overlayCss, /#kalamos-write-workspace-root \.tool-pill \{[\s\S]*position:\s*absolute/)
})

test('Standard editors stay WebView-only while Bigme retains its native handoff', () => {
  assert.match(
    writingEntry,
    /function shouldUseNativeInk\(\)[\s\S]*Bridge\.supportsPersistentDisplayHandoff\(\)/
  )
  assert.match(writingEntry, /if\s*\(shouldUseNativeInk\(\)\s*&&\s*!native\)\s*native\s*=\s*new Write2Native/)
  assert.doesNotMatch(writingNative, /setWebWorkspaceCover|standardToolbarCovered/)
  assert.match(editorController, /Bridge\.supportsPersistentDisplayHandoff\(\)\s*===\s*false/)
  assert.match(
    editorController,
    /if\s*\(needsStandardEditorHandoff\(\)\)\s*\{[\s\S]*Bridge\.enterLibrary\(\)[\s\S]*showStandardEditorHandoff\(\)[\s\S]*renderPageContent\(\)[\s\S]*return/
  )
  assert.match(editorController, /function appendStandardWebPointer\(e\)[\s\S]*activeStroke\.points\.push\(point\)/)
  assert.match(editorController, /function finishStandardWebStroke\(e\)[\s\S]*page\.strokes\.push\(stroke\)/)
  assert.doesNotMatch(inkManager, /fun setWebWorkspaceCover/)
  assert.match(
    editorController,
    /if\s*\(!inkSdkActive\)[\s\S]*Bridge\.setInkEnabled\(false\)[\s\S]*Bridge\.detachInkBoxForWeb\(\)/
  )
})

test('Standard reattach stays WebView-covered while Bigme keeps its retained-panel sequence', () => {
  assert.match(
    inkManager,
    /if\s*\(!persistentDisplay\)\s*\{[\s\S]*webView\.setBackgroundColor\(android\.graphics\.Color\.WHITE\)/
  )
  assert.match(
    inkManager,
    /if\s*\(persistentDisplay\)\s*\{[\s\S]*detachInkBoxForWeb: persistent display handoff/
  )
  assert.match(
    inkManager,
    /Do not apply this background transition to Bigme[\s\S]*visible full-panel refresh/
  )
})

test('Notes no longer mounts its classic drawing chrome', () => {
  assert.doesNotMatch(overlay,/snapshotNotesChrome|buildEditorChrome|notes-compact-bar|KalamosNotesTextBoxes/)
})

test('reader sketch Zoom retains its shared magnified page viewport', () => {
  assert.doesNotMatch(overlay, /EditorTools\.openZoom/)
  assert.doesNotMatch(overlay, /Canvas is fitted to the e-ink screen/)
  assert.match(editorController, /openZoom\(\)\s*\{\s*this\.openPad\('zoom'\)/)
  assert.match(editorController, /variant:\s*zoomMode\s*\?\s*'zoom'\s*:\s*'place'/)
  assert.match(editorController, /surface:\s*paper/)
  assert.match(editorController, /drawStandardHandoffTemplate\([\s\S]*drawStandardHandoffStroke/)
  assert.match(editorController, /Bigme keeps its[\s\S]*retained full-screen surface/)
  assert.match(inkTools, /write2\.magnify\.settings/)
  assert.match(inkTools, /ink-pad ink-pad-zoom magnify-pad hand-/)
  assert.match(inkTools, /magnify-target[\s\S]*<span>HERE<\/span>/)
  assert.match(
    inkTools,
    /data-command="previous"[\s\S]*data-command="next"[\s\S]*data-command="newline"[\s\S]*data-command="undo"[\s\S]*magnify-eraser[\s\S]*data-command="settings"[\s\S]*magnify-close/
  )
  assert.doesNotMatch(inkTools, /Zoom writing[\s\S]*Move zoom up/)
  assert.match(inkTools, /const baselineY = h \* 0\.54/)
  assert.match(editorController, /inkStyle\(\)\s*\{\s*return\s*\{\s*color:\s*activeColor,\s*width:\s*strokeWidth\s*\}/)
  assert.match(
    inkTools,
    /addNativeStrokes\(batch\)[\s\S]*color:\s*\(style\s*&&\s*style\.color\)[\s\S]*width:\s*\(style\s*&&\s*style\.width\)/
  )
  assert.match(editorController, /color:\s*ps\.color\s*\|\|\s*activeColor[\s\S]*width:\s*ps\.width\s*\|\|\s*strokeWidth/)
  assert.match(
    inkTools,
    /x:\s*this\._focus\.x\s*\+\s*\(p\.x\s*-\s*anchorX\)\s*\/\s*m[\s\S]*y:\s*this\._focus\.y\s*\+\s*\(p\.y\s*-\s*baselineY\)/
  )
  assert.match(inkTools, /width:\s*stroke\.width\s*,/)
  assert.match(inkTools, /getCoalescedEvents/)
  assert.match(
    inkTools,
    /drawLive\(pts\)[\s\S]*ctx\.moveTo\(pts\[pts\.length - 2\][\s\S]*onLiveSegment\(this\._mapZoomStroke/
  )
  assert.match(
    editorController,
    /onLiveSegment\(stroke\)[\s\S]*needsStandardEditorHandoff\(\)[\s\S]*drawStandardHandoffStroke/
  )
  assert.doesNotMatch(
    editorController,
    /onLiveSegment\(stroke\)[\s\S]{0,900}\n\s+(syncNativePage|Bridge\.snapshotToolbarRegion)\(/
  )
  assert.match(editorController, /function onPointerDown\(e\)\s*\{[\s\S]*if\s*\(e\.pointerType\s*===\s*'touch'\)\s*return/)
  assert.match(
    inkTools,
    /cv\.addEventListener\('pointerdown',\s*e\s*=>\s*\{[\s\S]*if\s*\(e\.pointerType\s*===\s*'touch'\)\s*return/
  )
  assert.doesNotMatch(
    inkTools,
    /const down = e => \{[\s\S]{0,350}if\s*\(e\.pointerType\s*===\s*'touch'\)\s*return/
  )
  assert.match(inkTools, /Every pointer type may position the Zoom target/)
  assert.match(editorController, /let strokeWidth\s*=\s*1/)
  assert.match(inkTools, /if\s*\(this\._variant\s*!==\s*'zoom'\)\s*this\.drawGuides\(\)/)
  assert.doesNotMatch(inkTools, /ctx\.moveTo\(anchorX,\s*baselineY/)
  assert.match(editorController, /if\s*\(!zoomMode\)\s*self\._rebakePad\(\)/)
})

test('retired parsed-plan storage and review UI are absent', () => {
  const assets = productionText(webRoot)
  assert.doesNotMatch(assets, /NotesPlanning|plan-state|plan\.md|parsed-plan|review mode/i)
  assert.doesNotMatch(assets, /this plan migrates all edge/i)
})

test('Planning uses one model preview writer and only reports successful atomic thumbnail writes', () => {
  assert.doesNotMatch(writingEntry, /prepareThumbnailCapture|captureAndDestroy/);
  assert.match(storageWeb, /if \(saved && typeof window\.onThumbnailReady === 'function'\) window\.onThumbnailReady\(notebookId\)/);
});

test('classic scribble erases page and staged Zoom ink in one reversible transaction', () => {
  const source=readFileSync(join(repoRoot,'foundation/android-runtime/src/main/assets/web/js/scribble-erase.js'),'utf8')
  const context={uid:()=>"scribble-qa",window:{},localStorage:{getItem:()=>null},Set,Math,Number}
  context.window=context
  context.History={push(undo,redo){this.undo=undo;this.redo=redo},updateButtons(){}}
  const refresh=[];context.syncNativePage=rect=>refresh.push(rect);context.triggerAutosave=()=>{}
  runInNewContext(source,context)
  // Exercise the actual controller method without bootstrapping unrelated Android UI.
  const method=editorController.slice(editorController.indexOf('  eraseScribble(page,'),editorController.indexOf('  eraseLasso(page,'))
  runInNewContext('this.tools={'+method+'}',context)
  const stroke=x=>({width:2,points:[{x,y:15},{x,y:65}]})
  const first=stroke(55),neighbor=stroke(130),pending=stroke(65)
  const page={strokes:[first,neighbor],template:{spacing:44}}
  let staged=[pending]
  const gesture=Array.from({length:7},(_,i)=>({x:i%2?100:20,y:30+i*2}))
  assert.equal(context.tools.eraseScribble(page,gesture,{strokes:staged,restore:s=>{staged=s}}),true)
  assert.deepEqual(page.strokes,[neighbor]);assert.equal(staged.length,0)
  assert.equal(refresh.length,1);assert.ok(refresh[0].x+refresh[0].w<130)
  context.History.undo()
  assert.equal(page.strokes.length,3);assert.deepEqual(page.strokes[0],first);assert.deepEqual(page.strokes[2].points,pending.points);assert.equal(staged.length,0)
  context.History.redo()
  assert.deepEqual(page.strokes,[neighbor]);assert.equal(staged.length,0)
})

test('default notebook numbers survive rename/delete, imports and cancellation', () => {
  const method = overlay.slice(overlay.indexOf('  function nextNotebookNumber()'), overlay.indexOf('  function openCreateDialog()'))
  let counter = null
  const context = { libraryData: {notebooks:[]}, localStorage:{getItem:()=>counter} }
  assert.equal(runInNewContext(method+';nextNotebookNumber()',context),1)
  // Looking at the prompt does not consume a number.
  assert.equal(runInNewContext(method+';nextNotebookNumber()',context),1)
  counter='4'; context.libraryData.notebooks=[{title:'Renamed notebook'}]
  assert.equal(runInNewContext(method+';nextNotebookNumber()',context),5)
  context.libraryData.notebooks.push({title:'Notebook 12'})
  assert.equal(runInNewContext(method+';nextNotebookNumber()',context),13)
})
