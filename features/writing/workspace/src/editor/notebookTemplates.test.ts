import { describe, expect, it } from 'vitest';
import { createNotebookTemplate, NOTEBOOK_TEMPLATES } from './notebookTemplates';
import { validateSidecar, serializeSidecar } from '../sidecar/schema';
import { fingerprintOf } from '../documents/fingerprint';
import { objectSvg } from './pageObjects';

describe('smart notebook starters', () => {
  for (const template of NOTEBOOK_TEMPLATES) it(`${template.name} saves as normal ruled content`, () => {
    const {source,sidecar} = createNotebookTemplate(template.id,'Notebook 1',572,56);
    expect(sidecar.documentFingerprint).toBe(fingerprintOf(source).hash);
    expect(validateSidecar(JSON.parse(serializeSidecar(sidecar)))).toMatchObject({ok:true,sidecar});
    expect(sidecar.textBoxes?.every(b => b.y%56 === 0 && b.x+b.width<=572)).toBe(true);
  });
  it('week contains all seven days and enough space below each heading', () => {
    const boxes = createNotebookTemplate('week','Week',572,56).sidecar.textBoxes!;
    expect(boxes.map(b=>b.text)).toEqual(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
    expect(boxes[1].y-boxes[0].y).toBe(112);
  });
  it('checklists occupy the row end and preserve their interactive field', () => {
    const {sidecar} = createNotebookTemplate('tasks','Tasks',1000,44);
    expect(sidecar.textBoxes?.filter(b=>b.checkbox)).toHaveLength(12);
    expect(sidecar.textBoxes?.filter(b=>b.checkbox).every(b=>b.x===948 && b.width===36)).toBe(true);
    const checked = {...sidecar,textBoxes:sidecar.textBoxes?.map(b=>b.checkbox?{...b,text:'☑'}:b)};
    expect(validateSidecar(JSON.parse(serializeSidecar(checked)))).toMatchObject({ok:true,sidecar:checked});
  });
  it('free vectors retain aspect and line direction in export', () => {
    const object = {id:'o',kind:'line' as const,x:30,y:40,width:80,height:20,color:'#1838D8',strokeWidth:3,points:[{x:100,y:0},{x:0,y:100}]};
    expect(objectSvg(object)).toContain('M100,0 L0,100');
    expect(objectSvg(object)).toContain('preserveAspectRatio="none"');
    const {sidecar} = createNotebookTemplate('ruled','Note',572,56);
    sidecar.pageObjects = [object];
    expect(validateSidecar(JSON.parse(serializeSidecar(sidecar)))).toMatchObject({ok:true,sidecar:{pageObjects:[object]}});
    expect(validateSidecar({...sidecar,pageObjects:[{...object,width:-1}]})).toMatchObject({ok:true,sidecar:{pageObjects:[]}});
  });
});
