import { describe, it, expect } from 'vitest';
import { convertLegacyPage } from './legacyNotebook';
describe('legacy notebook vector conversion', () => {
  it('preserves positions, width, pressure and timing without mutating original page', () => {
    const page={pageId:'p',strokes:[{width:3,points:[{x:110,y:30,p:.7,t:100},{x:130,y:70,p:.3,t:200}]}]};
    const before=JSON.stringify(page);
    const {sidecar}=convertLegacyPage(page,'Old note');
    const run=sidecar.inkRuns[0];
    expect(run.strokes[0].points.map(p=>({x:p.x+run.layoutX!,y:p.y+run.layoutY!,p:p.pressure,t:p.t}))).toEqual(page.strokes[0].points);
    expect(run.strokes[0].width).toBe(3);
    expect(JSON.stringify(page)).toBe(before);
  });
  it('retains separate strokes and text using the current ruled text model', () => {
    const {sidecar}=convertLegacyPage({pageId:'p',strokes:[{points:[{x:2,y:3}]},{points:[{x:400,y:200}]}],texts:[{text:'hello',x:20,y:60,size:28}]},'Title');
    expect(sidecar.inkRuns).toHaveLength(2);
    expect(sidecar.textBoxes?.[0]).toMatchObject({text:'hello',x:20,y:56,size:28,autoWidth:true});
  });
  it('rejects invalid vectors instead of silently converting to a blank page', () => {
    expect(()=>convertLegacyPage({pageId:'p',strokes:[{points:[{x:NaN,y:2}]}]},'Title')).toThrow();
    expect(()=>convertLegacyPage({pageId:'p',strokes:null as never},'Title')).toThrow();
  });
});
