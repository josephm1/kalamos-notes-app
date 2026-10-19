import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '../markdown/parse';
import { DEFAULT_PREFERENCES } from '../storage/preferences';
import { PenWorkspace } from './penWorkspace';
import type { TextBox } from '../sidecar/schema';
const active: PenWorkspace[] = [];
const L = 44;
beforeAll(() => {
    (HTMLCanvasElement.prototype as any).getContext = () => ({ font: '', measureText: (s: string) => ({ width: s.length * 8 }), setTransform() { }, clearRect() { }, beginPath() { }, moveTo() { }, lineTo() { }, closePath() { }, stroke() { }, fill() { } });
    (globalThis as any).ResizeObserver = class {
        observe() { }
        disconnect() { }
    };
});
afterEach(() => { active.splice(0).forEach(ws => ws.destroy()); document.body.replaceChildren(); });
const pts = (coords: number[][]) => coords.map(([x, y], t) => ({ x, y, t, pressure: .5 }));
function create(textBoxes: TextBox[] = [{ id: 'typed', blockId: '', text: 'eggs', x: 140, y: 88, width: 80, size: 19 }], runs: any[] = []) {
    const host = document.createElement('div');
    document.body.append(host);
    const commit = vi.fn();
    const ws = new PenWorkspace(host, { block: parseMarkdown('\u200b')[0], existingRuns: runs, existingTextBoxes: textBoxes, prefs: DEFAULT_PREFERENCES, eink: true, native: true, onCommit: commit, onCancel() { } });
    active.push(ws);
    return { ws, host, commit };
}
function fixture() { const f = create(); f.ws.applyNativeWriteStroke(pts([[30, 94], [60, 116], [75, 100]]), false); return f; }
function snapshot(ws: PenWorkspace) { return { ink: ws.getNativeInkStrokes().map(s => s.pts.map(p => ({ x: p.x, y: p.y }))), text: [...ws.containerElement.querySelectorAll<HTMLElement>('[data-text-box-word]')].map(n => ({ text: n.textContent, x: parseFloat(n.style.left), y: parseFloat(n.style.top) })) }; }
function select(ws: PenWorkspace) { const s = snapshot(ws); const all = [...s.ink.flat(), ...s.text.flatMap(w => [{ x: w.x, y: w.y }, { x: w.x + 35, y: w.y + 35 }])]; const l = Math.min(...all.map(p => p.x)) - 10, r = Math.max(...all.map(p => p.x)) + 10, t = Math.min(...all.map(p => p.y)) - 10, b = Math.max(...all.map(p => p.y)) + 10; ws.setActiveTool('select'); ws.selectLasso(pts([[l, t], [r, t], [r, b], [l, b], [l, t]])); }
function pointer(ws: PenWorkspace, type: string, x: number, y: number) { const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, buttons: type === 'pointerup' ? 0 : 1 }); Object.defineProperties(e, { pointerId: { value: 17 }, pointerType: { value: 'pen' }, pressure: { value: .5 } }); ws.containerElement.dispatchEvent(e); }
function move(ws: PenWorkspace, dx: number, dy: number) { const b = ws.getSelectedBlockBounds()!; const x = b.x + 4, y = b.y + 4; pointer(ws, 'pointerdown', x, y); pointer(ws, 'pointermove', x + dx, y + dy); pointer(ws, 'pointerup', x + dx, y + dy); }
function translated(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>, dx: number, dy: number) { expect(after.ink.length).toBe(before.ink.length); before.ink.forEach((s, i) => s.forEach((p, j) => { expect(after.ink[i][j].x - p.x).toBeCloseTo(dx, 4); expect(after.ink[i][j].y - p.y).toBeCloseTo(dy, 4); })); expect(after.text.map(w => w.text)).toEqual(before.text.map(w => w.text)); before.text.forEach((p, i) => { expect(after.text[i].x - p.x).toBeCloseTo(dx, 4); expect(after.text[i].y - p.y).toBeCloseTo(dy, 4); }); }
function assertDomGeometry(ws: PenWorkspace) { const s = snapshot(ws), box = ws.getSelectedBlockBounds()!; const rect = ws.containerElement.querySelector<HTMLElement>('.rw-selection-box')!; expect(parseFloat(rect.style.left)).toBeCloseTo(box.x); expect(parseFloat(rect.style.width)).toBeCloseTo(box.width); for (const el of ws.containerElement.querySelectorAll<SVGElement>('.rw-ink')) {
    expect(el.style.transform).toBe('');
    const id = el.dataset.insertId;
    const index = ws.reflowDoc.inserts.filter(i => i.kind === 'ink').findIndex(i => i.id === id);
    const vb = el.getAttribute('viewBox')!.split(' ').map(Number);
    for (const p of s.ink[index]) {
        expect(p.x).toBeGreaterThanOrEqual(box.x);
        expect(p.x).toBeLessThanOrEqual(box.x + box.width);
        expect(p.y).toBeGreaterThanOrEqual(box.y);
        expect(p.y).toBeLessThanOrEqual(box.y + box.height);
    }
    expect(Number.isFinite(vb[0])).toBe(true);
} }
describe('mixed layout transactions', () => {
    it('matches rendered SVG and selection bounds after repeated drags, undo and redo', () => { const { ws, host } = fixture(); select(ws); let before = snapshot(ws); for (const [dx, dy] of [[30, 44], [-15, 44], [20, -44]]) {
        move(ws, dx, dy);
        translated(before, snapshot(ws), dx, dy);
        assertDomGeometry(ws);
        before = snapshot(ws);
    } host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click(); assertDomGeometry(ws); host.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click(); assertDomGeometry(ws); });
    it.each(['horizontal', 'vertical', 'both'] as const)('moves mixed selection after %s space without replaying that space', kind => { const { ws } = fixture(); if (kind !== 'vertical') {
        ws.setActiveTool('insert');
        ws.applyNativeStroke(pts([[10, 98], [50, 98]]));
    } if (kind !== 'horizontal') {
        ws.setActiveTool('lines');
        ws.applyNativeStroke(pts([[8, 88], [8, 132]]));
    } select(ws); const before = snapshot(ws); move(ws, 20, 44); translated(before, snapshot(ws), 20, 44); assertDomGeometry(ws); });
    it.each(['horizontal', 'vertical'] as const)('adding then removing %s space restores mixed geometry', kind => { const { ws } = fixture(); const before = snapshot(ws); ws.setActiveTool(kind === 'horizontal' ? 'insert' : 'lines'); ws.applyNativeStroke(kind === 'horizontal' ? pts([[10, 98], [70, 98]]) : pts([[8, 88], [8, 176]])); const gap = ws.reflowDoc.inserts.find(i => i.kind === (kind === 'horizontal' ? 'gap' : 'line'))!; ws.applyNativeStroke(kind === 'horizontal' ? pts([[gap.scopeX! + gap.width, 98], [gap.scopeX!, 98]]) : pts([[8, (gap.scopeLine! + gap.lines!) * L], [8, gap.scopeLine! * L]])); expect(snapshot(ws)).toEqual(before); });
    it('preserves positions through horizontal → vertical → move → save/reopen', () => { const { ws, commit } = fixture(); ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[10, 98], [50, 98]])); ws.setActiveTool('lines'); ws.applyNativeStroke(pts([[8, 88], [8, 132]])); select(ws); move(ws, 15, 44); const before = snapshot(ws); ws.finish(); const p = commit.mock.calls[0][0]; expect(snapshot(create(p.textBoxes, p.newRuns).ws)).toEqual(before); });
    it('cancels a preview without leaving ink or box translated', () => { const { ws } = fixture(); select(ws); const before = snapshot(ws), b = ws.getSelectedBlockBounds()!; pointer(ws, 'pointerdown', b.x + 4, b.y + 4); pointer(ws, 'pointermove', b.x + 34, b.y + 48); pointer(ws, 'pointercancel', b.x + 34, b.y + 48); expect(snapshot(ws)).toEqual(before); assertDomGeometry(ws); });
});
it.each(['horizontal', 'vertical', 'both'] as const)('moves after subtracting %s space without changing group shape', kind => {
    const f = fixture(), { ws } = f;
    // Leave enough original whitespace for negative space without crossing existing content.
    if (kind !== 'vertical') {
        ws.setActiveTool('insert');
        ws.applyNativeStroke(pts([[100, 98], [80, 98]]));
    }
    if (kind !== 'horizontal') {
        ws.setActiveTool('lines');
        ws.applyNativeStroke(pts([[8, 88], [8, 44]]));
    }
    select(ws);
    const before = snapshot(ws);
    move(ws, 20, 44);
    translated(before, snapshot(ws), 20, 44);
    assertDomGeometry(ws);
});
it('keeps a mixed group rigid when dropped next to an unselected word', () => {
    const { ws } = create([{ id: 'typed', blockId: '', text: 'eggs', x: 140, y: 88, width: 80, size: 19 }, { id: 'other', blockId: '', text: 'milk', x: 230, y: 88, width: 70, size: 19 }]);
    ws.applyNativeWriteStroke(pts([[30, 94], [60, 116], [75, 100]]), false);
    ws.setActiveTool('select');
    ws.selectLasso(pts([[20, 78], [180, 78], [180, 125], [20, 125], [20, 78]]));
    const before = snapshot(ws);
    move(ws, 70, 0);
    const after = snapshot(ws);
    before.ink[0].forEach((p, j) => expect(after.ink[0][j].x - p.x).toBeCloseTo(70));
    expect(after.text.find(w => w.text === 'eggs')!.x - before.text.find(w => w.text === 'eggs')!.x).toBeCloseTo(70);
    assertDomGeometry(ws);
});
it.each(['horizontal', 'vertical'] as const)('negative %s space can be reversed without corrupting typed/ink placement', kind => {
    const { ws } = fixture(), before = snapshot(ws);
    ws.setActiveTool(kind === 'horizontal' ? 'insert' : 'lines');
    ws.applyNativeStroke(kind === 'horizontal' ? pts([[100, 98], [80, 98]]) : pts([[8, 88], [8, 44]]));
    const op = ws.reflowDoc.inserts.find(i => i.kind === (kind === 'horizontal' ? 'gap' : 'line'))!;
    ws.applyNativeStroke(kind === 'horizontal' ? pts([[op.scopeX! + op.width, 98], [op.scopeX!, 98]]) : pts([[8, (op.scopeLine! + op.lines!) * L], [8, op.scopeLine! * L]]));
    expect(snapshot(ws)).toEqual(before);
});
const operations = ['horizontal+', 'horizontal-', 'vertical+', 'vertical-'] as const;
function permutations<T>(items: T[]): T[][] { return items.length ? items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest])) : [[]]; }
it.each(permutations([...operations]).map(sequence => [sequence.join(' → '), sequence] as const))('mixed transaction sequence: %s', (_, sequence) => {
    const { ws, host, commit } = fixture();
    for (const action of sequence) {
        const before = snapshot(ws);
        const vertical = action.startsWith('vertical');
        ws.setActiveTool(vertical ? 'lines' : 'insert');
        // Negative vertical gestures remove blank space above the content, not occupied rows.
        const y = vertical ? 44 : Math.min(...before.text.map(w => w.y), ...before.ink.flat().map(p => p.y)) + 8;
        const x = action === "horizontal-" ? before.text[0].x - 8 : Math.min(...before.text.map(w => w.x), ...before.ink.flat().map(p => p.x)) - 8;
        ws.applyNativeStroke(vertical ? pts([[8, y], [8, y + (action.endsWith('+') ? 44 : -44)]]) : pts([[x, y], [x + (action.endsWith('+') ? 20 : -20), y]]));
        const after = snapshot(ws);
        expect(after.ink.flat().every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        expect(after.text.map(w => w.text)).toEqual(before.text.map(w => w.text));
        host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
        expect(snapshot(ws)).toEqual(before);
        host.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
        expect(snapshot(ws)).toEqual(after);
    }
    select(ws);
    const prior = snapshot(ws);
    move(ws, 10, 44);
    translated(prior, snapshot(ws), 10, 44);
    assertDomGeometry(ws);
    const final = snapshot(ws);
    ws.finish();
    const payload = commit.mock.calls[0][0];
    expect(snapshot(create(payload.textBoxes, payload.newRuns).ws)).toEqual(final);
});
it('uses one clamped movement for the entire group at the page edge', () => {
    const { ws } = fixture();
    select(ws);
    const before = snapshot(ws);
    move(ws, 1000, 0);
    const after = snapshot(ws);
    const dx = after.text[0].x - before.text[0].x;
    translated(before, after, dx, 0);
    expect(dx).toBeGreaterThan(0);
    assertDomGeometry(ws);
});

describe('Write-inspired spacing gestures', () => {
    it.each(['insert', 'lines'] as const)('%s contact does not move content or consume Undo', tool => {
        const { ws, host } = fixture(), before = snapshot(ws);
        ws.setActiveTool(tool);
        pointer(ws, 'pointerdown', 10, 88);
        expect(snapshot(ws)).toEqual(before);
        pointer(ws, 'pointerup', 10, 88);
        expect(snapshot(ws)).toEqual(before);
        expect(ws.reflowDoc.inserts.some(i => i.kind !== 'ink')).toBe(false);
        host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
        expect(snapshot(ws).ink).toHaveLength(0); // Undo still owns the actual handwriting stroke.
        host.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
        expect(snapshot(ws)).toEqual(before);
    });
    it.each(['insert', 'lines'] as const)('%s cancellation restores the document and its previous redo chain', tool => {
        const { ws, host } = fixture();
        host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
        const before = snapshot(ws), doc = ws.reflowDoc;
        ws.setActiveTool(tool);
        pointer(ws, 'pointerdown', 10, 88);
        pointer(ws, 'pointermove', 90, 176);
        pointer(ws, 'pointercancel', 90, 176);
        expect(ws.reflowDoc).toBe(doc);
        expect(snapshot(ws)).toEqual(before);
        host.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
        expect(snapshot(ws).ink).toHaveLength(1);
    });
    it('pressure consumes spare gaps; reversal releases pushed neighbours', () => {
        const { ws } = create([
            { id: 'a', blockId: '', text: 'buy', x: 10, y: 88, width: 50, size: 19 },
            { id: 'b', blockId: '', text: 'milk', x: 140, y: 88, width: 50, size: 19 },
            { id: 'c', blockId: '', text: 'today', x: 240, y: 88, width: 50, size: 19 },
        ]);
        ws.applyNativeWriteStroke(pts([[90, 94], [105, 115], [115, 94]]), false);
        const before = snapshot(ws);
        ws.setActiveTool('insert');
        ws.applyNativeStroke(pts([[70, 98], [90, 98]]));
        let after = snapshot(ws);
        expect(after.text[0]).toEqual(before.text[0]);
        expect(after.text[1].x).toBeCloseTo(156.6); // Ink right edge 119 + motion 20 + safe gap 17.6.
        expect(after.text[2]).toEqual(before.text[2]);
        expect(after.ink[0][0].x - before.ink[0][0].x).toBeCloseTo(20);
        ws.applyNativeStroke(pts([[90, 98], [50, 98]])); // Cross zero during the same handle edit.
        after = snapshot(ws);
        expect(after.text[0].y).toBe(before.text[0].y - L);
        for (const i of [1, 2]) expect(after.text[i]).toEqual(before.text[i]);
        expect(after.ink).toEqual(before.ink);
        ws.applyNativeStroke(pts([[50, 98], [70, 98]]));
        expect(snapshot(ws)).toEqual(before);
    });
    it('commits small horizontal adjustments instead of jumping back at pen-up', () => {
        const { ws } = fixture(), before = snapshot(ws);
        ws.setActiveTool('insert');
        ws.applyNativeStroke(pts([[10, 98], [14, 98]]));
        expect(snapshot(ws).ink[0][0].x - before.ink[0][0].x).toBe(4);
        expect(snapshot(ws).text).toEqual(before.text);
    });
    it('closing vertical space stops at the previous occupied row and keeps every word', () => {
        const { ws, commit } = create([
            { id: 'top', blockId: '', text: 'heading', x: 10, y: 0, width: 80, size: 19 },
            { id: 'lower', blockId: '', text: 'milk', x: 140, y: 132, width: 80, size: 19 },
        ]);
        ws.applyNativeWriteStroke(pts([[30, 138], [60, 160], [75, 144]]), false);
        const before = snapshot(ws);
        ws.setActiveTool('lines');
        ws.applyNativeStroke(pts([[8, 132], [8, 0]]));
        const after = snapshot(ws);
        expect(after.text[0]).toEqual(before.text[0]);
        expect(after.text[1].y).toBe(44);
        expect(after.ink[0][0].y - before.ink[0][0].y).toBe(-88);
        expect(ws.reflowDoc.inserts.find(i => i.kind === 'line')?.lines).toBe(-2);
        ws.finish(); const payload = commit.mock.calls[0][0];
        expect(snapshot(create(payload.textBoxes, payload.newRuns).ws)).toEqual(after);
    });
    it('does not pull a deliberate following row into the current row', () => {
        const { ws } = create([
            { id: 'a', blockId: '', text: 'buy', x: 140, y: 88, width: 60, size: 19 },
            { id: 'b', blockId: '', text: 'milk', x: 10, y: 132, width: 60, size: 19 },
        ]);
        const before = snapshot(ws);
        ws.setActiveTool('insert');
        ws.applyNativeStroke(pts([[100, 98], [110, 98]]));
        expect(snapshot(ws).text[1]).toEqual(before.text[1]);
    });
    it('reverses live overflow from the original positions without accumulating rounding or changing other rows', async () => {
        const { ws } = fixture(), before = snapshot(ws);
        ws.setActiveTool('insert');
        pointer(ws, 'pointerdown', 10, 98);
        pointer(ws, 'pointermove', 310, 98);
        await new Promise(requestAnimationFrame);
        expect(snapshot(ws).text[0].y).toBeGreaterThan(before.text[0].y);
        pointer(ws, 'pointermove', 50, 98);
        await new Promise(requestAnimationFrame);
        expect(snapshot(ws).ink[0][0].x - before.ink[0][0].x).toBe(40);
        expect(snapshot(ws).text).toEqual(before.text);
        pointer(ws, 'pointermove', 10, 98);
        await new Promise(requestAnimationFrame);
        pointer(ws, 'pointerup', 10, 98);
        expect(snapshot(ws)).toEqual(before);
    });
});

describe('reported Hello / X regressions', () => {
    it('uses the existing handwriting buffer before moving a distant X', () => {
        const { ws } = create([{ id: 'x', blockId: '', text: 'X', x: 250, y: 88, width: 40, size: 19 }]);
        ws.applyNativeWriteStroke(pts([[30, 94], [60, 116], [75, 100]]), false);
        const before = snapshot(ws);
        ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[15, 98], [65, 98]]));
        expect(snapshot(ws).text).toEqual(before.text);
        expect(snapshot(ws).ink[0][0].x - before.ink[0][0].x).toBe(50);
    });
    it('a backward drag in X snaps the caret before X and moves only the left ink', () => {
        const { ws } = create([{ id: 'x', blockId: '', text: 'XXXX', x: 250, y: 88, width: 40, size: 19 }]);
        ws.applyNativeWriteStroke(pts([[30, 94], [60, 116], [75, 100]]), false);
        const before = snapshot(ws);
        ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[278, 98], [228, 98]]));
        expect(snapshot(ws).text[0]).toEqual(before.text[0]);
        expect(snapshot(ws).ink[0][0].y).toBe(before.ink[0][0].y - L);
    });
});

it('reopening a visible handle releases pushed words and restores the pre-wrap rows', () => {
    const { ws } = fixture(), before = snapshot(ws);
    ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[10, 98], [310, 98]]));
    expect(snapshot(ws).text[0].y).toBeGreaterThan(before.text[0].y);
    const edge = Number.parseFloat(ws.containerElement.querySelector<HTMLElement>('.rw-insertion-guide')!.style.left);
    ws.applyNativeStroke(pts([[edge, 98], [edge - 300, 98]]));
    expect(snapshot(ws)).toEqual(before);
});
it('new handwriting invalidates an old spacing snapshot without losing the new stroke', () => {
    const { ws } = fixture();
    ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[10, 98], [50, 98]]));
    const oldEdge = Number.parseFloat(ws.containerElement.querySelector<HTMLElement>('.rw-insertion-guide')!.style.left);
    ws.setActiveTool('write'); ws.applyNativeWriteStroke(pts([[200, 182], [220, 204]]), false);
    const added = snapshot(ws).ink[1];
    ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[oldEdge, 98], [oldEdge + 10, 98]]));
    expect(snapshot(ws).ink).toHaveLength(2);
    expect(snapshot(ws).ink[1]).toEqual(added);
});
it('layout edits preserve exact typed styles and all original pen attributes through save/reopen', () => {
    const text = { id: 'styled', blockId: '', text: 'buy milk', x: 140, y: 88, width: 120, size: 19,
        styles: [{ start: 0, end: 3, bold: true as const }] };
    const { ws, commit } = create([text]);
    ws.applyNativeWriteStroke(pts([[30, 94], [60, 116], [75, 100]]), false);
    const before = ws.getNativeInkStrokes()[0];
    ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[10, 98], [60, 98]]));
    ws.setActiveTool('lines'); ws.applyNativeStroke(pts([[8, 88], [8, 132]]));
    ws.finish(); const payload = commit.mock.calls[0][0];
    expect(payload.textBoxes[0].text).toBe(text.text);
    expect(payload.textBoxes[0].styles).toEqual(text.styles);
    const reopened = create(payload.textBoxes, payload.newRuns).ws;
    expect(snapshot(reopened)).toEqual(snapshot(ws));
    const after = reopened.getNativeInkStrokes()[0];
    expect(after.color).toBe(before.color); expect(after.width).toBe(before.width);
    before.pts.forEach((point, index) => {
        expect(after.pts[index].x - point.x).toBeCloseTo(50);
        expect(after.pts[index].y - point.y).toBeCloseTo(44);
    });
});
it.each(['insert', 'lines'] as const)('%s mode changes cancel pending frames and preserve the previous document', async tool => {
    const { ws } = fixture(), before = snapshot(ws);
    ws.setActiveTool(tool); pointer(ws, 'pointerdown', 10, 88); pointer(ws, 'pointermove', 90, 176);
    ws.setActiveTool('write'); await new Promise(requestAnimationFrame);
    expect(snapshot(ws)).toEqual(before);
});
it('saving during a pending spacing frame commits the latest pointer sample once', () => {
    const { ws, commit, host } = fixture(), before = snapshot(ws);
    ws.setActiveTool('insert'); pointer(ws, 'pointerdown', 10, 98); pointer(ws, 'pointermove', 50, 98);
    ws.finish();
    const payload = commit.mock.calls[0][0];
    expect(snapshot(create(payload.textBoxes, payload.newRuns).ws)).toEqual(snapshot(ws));
    expect(snapshot(ws).ink[0][0].x - before.ink[0][0].x).toBe(40);
    host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(snapshot(ws)).toEqual(before);
});
it.each(['mouse', 'pen'] as const)('%s pointer spacing agrees with a completed native gesture', type => {
    const native = fixture(), web = fixture();
    native.ws.setActiveTool('insert'); native.ws.applyNativeStroke(pts([[10, 98], [70, 98]]));
    web.ws.setActiveTool('insert');
    for (const [eventType, x] of [['pointerdown', 10], ['pointermove', 70], ['pointerup', 70]] as const) {
        const e = new MouseEvent(eventType, { clientX: x, clientY: 98, bubbles: true, buttons: eventType === 'pointerup' ? 0 : 1 });
        Object.defineProperties(e, { pointerId: { value: 29 }, pointerType: { value: type }, pressure: { value: .5 } });
        web.ws.containerElement.dispatchEvent(e);
    }
    expect(snapshot(web.ws)).toEqual(snapshot(native.ws));
});

describe('eggs trailing-caret device regression', () => {
    function page() {
        const f = create([
            { id: 'eggs', blockId: '', text: 'eggs', x: 180, y: 88, width: 50, size: 19 },
            { id: 'check', blockId: '', text: '☑', x: 276, y: 88, width: 36, size: 19, checkbox: true },
        ]);
        f.ws.applyNativeWriteStroke(pts([[30, 94], [60, 116], [75, 100]]), false);
        return f;
    }
    it.each([212, 214, 240])('a fresh caret at %i after eggs moves only eggs backward', contact => {
        const { ws } = page(), before = snapshot(ws);
        ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[contact, 98], [contact - 40, 98]]));
        const after = snapshot(ws);
        expect(after.text.find(w => w.text === 'eggs')!.x).toBe(140);
        expect(after.text.find(w => w.text === '☑')).toEqual(before.text.find(w => w.text === '☑'));
        expect(after.ink).toEqual(before.ink);
    });
    it('a trailing handle reverses through zero, preserves history and saves exact coordinates', () => {
        const { ws, host, commit } = page(), before = snapshot(ws);
        ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[214, 98], [254, 98]]));
        expect(snapshot(ws).text[0].x).toBe(220);
        ws.applyNativeStroke(pts([[254, 98], [174, 98]]));
        const after = snapshot(ws);
        expect(after.text[0].x).toBe(140); expect(after.ink).toEqual(before.ink);
        host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
        expect(snapshot(ws).text[0].x).toBe(220);
        host.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
        expect(snapshot(ws)).toEqual(after);
        ws.finish(); const p = commit.mock.calls[0][0];
        const reopened = create(p.textBoxes, p.newRuns).ws;
        expect(snapshot(reopened)).toEqual(after);
        reopened.setActiveTool('insert'); reopened.applyNativeStroke(pts([[174, 98], [154, 98]]));
        expect(snapshot(reopened).text[0].x).toBe(120);
        expect(snapshot(reopened).ink).toEqual(before.ink);
    });
    it('still targets eggs after a rigid move and new writing invalidate a previous handle', () => {
        const { ws } = page();
        ws.setActiveTool('select'); ws.applyNativeStroke(pts([[185, 98], [205, 98]]));
        expect(snapshot(ws).text[0].x).toBe(200);
        ws.setActiveTool('write'); ws.applyNativeWriteStroke(pts([[100, 182], [120, 204]]), false);
        const before = snapshot(ws);
        ws.setActiveTool('insert'); ws.applyNativeStroke(pts([[234, 98], [194, 98]]));
        expect(snapshot(ws).text[0].x).toBe(160);
        expect(snapshot(ws).ink).toEqual(before.ink);
        expect(snapshot(ws).text[1]).toEqual(before.text[1]);
    });
    it('live pen pointer motion agrees with the completed native spacing gesture', async () => {
        const { ws } = page(), before = snapshot(ws);
        ws.setActiveTool('insert'); pointer(ws, 'pointerdown', 214, 98);
        expect(snapshot(ws)).toEqual(before);
        pointer(ws, 'pointermove', 174, 98); await new Promise(requestAnimationFrame);
        expect(snapshot(ws).text[0].x).toBe(140);
        pointer(ws, 'pointercancel', 174, 98); expect(snapshot(ws)).toEqual(before);
        pointer(ws, 'pointerdown', 214, 98); pointer(ws, 'pointermove', 174, 98); pointer(ws, 'pointerup', 174, 98);
        expect(snapshot(ws).text[0].x).toBe(140); expect(snapshot(ws).ink).toEqual(before.ink);
    });
});


it.each(['native','pen','mouse'].flatMap(type=>[225,231,258].map(contact=>[type,contact] as const)))('%s leftward contact at %i uses the visible caret boundary and saves it', (type,contact)=>{
    const {ws,host,commit}=create([
      {id:'hello',blockId:'',text:'hello',x:100,y:88,width:50,size:19},
      {id:'world',blockId:'',text:'world',x:230,y:88,width:50,size:19},
    ]);
    const before=snapshot(ws);
    ws.setActiveTool('insert');
    if(type==='native') ws.applyNativeStroke(pts([[contact,98],[contact-20,98]]));
    else for(const [eventType,x] of [['pointerdown',contact],['pointermove',contact-20],['pointerup',contact-20]] as const) {
      const event=new MouseEvent(eventType,{clientX:x,clientY:98,bubbles:true,buttons:eventType==='pointerup'?0:1});
      Object.defineProperties(event,{pointerId:{value:29},pointerType:{value:type},pressure:{value:.5}});
      ws.containerElement.dispatchEvent(event);
    }
    const moved=snapshot(ws);
    expect(moved.text[0].x).toBe(80);
    expect(moved.text[1]).toEqual(before.text[1]);
    host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(snapshot(ws)).toEqual(before);
    host.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    expect(snapshot(ws)).toEqual(moved);
    ws.finish();const payload=commit.mock.calls[0][0];
    expect(snapshot(create(payload.textBoxes,payload.newRuns).ws)).toEqual(moved);
});

it.each(['native','pen','mouse'] as const)('%s barely-inside ink hit leaves the word beyond the snapped caret fixed',type=>{
    const {ws}=create([]);
    ws.applyNativeWriteStroke(pts([[30,94],[60,116],[75,100]]),false);
    ws.applyNativeWriteStroke(pts([[212,94],[250,116],[300,100]]),false);
    const before=snapshot(ws);
    expect(before.ink).toHaveLength(2);
    ws.setActiveTool('insert');
    // Ink includes four pixels of padded bounds: 209 is just inside its leading edge (208).
    if(type==='native') ws.applyNativeStroke(pts([[209,98],[189,98]]));
    else {
      for(const [eventType,x] of [['pointerdown',209],['pointermove',189],['pointerup',189]] as const) {
        const event=new MouseEvent(eventType,{clientX:x,clientY:98,bubbles:true,buttons:eventType==='pointerup'?0:1});
        Object.defineProperties(event,{pointerId:{value:29},pointerType:{value:type},pressure:{value:.5}});
        ws.containerElement.dispatchEvent(event);
      }
    }
    const moved=snapshot(ws);
    expect(moved.ink[0][0].x).toBe(before.ink[0][0].x-20);
    expect(moved.ink[1]).toEqual(before.ink[1]);
});
