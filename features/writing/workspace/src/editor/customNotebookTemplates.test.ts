import {describe,it,expect} from 'vitest';
import {parseCustomNotebookTemplates} from './customNotebookTemplates';
import {fingerprintOf} from '../documents/fingerprint';

describe('custom ruled starters',()=>{
 it('loads editable fields and refreshes the fingerprint for supplied Markdown',()=>{
  const [template]=parseCustomNotebookTemplates([{filename:'my-plan.json',template:{schema:'kalamos.notes.template.v1',name:'My plan',source:'My heading',sidecar:{layoutLineHeight:56,textBoxes:[{id:'task',blockId:'planning-document',text:'☐',x:200,y:112,width:36,size:32,checkbox:true}]}}}]);
  expect(template.id).toBe('custom:my-plan.json');
  expect(template.sidecar.documentFingerprint).toBe(fingerprintOf('My heading').hash);
  expect(template.sidecar.textBoxes?.[0].checkbox).toBe(true);
 });
 it('rejects traversals, other schemas and executable file types',()=>{
  const template={schema:'kalamos.notes.template.v1',name:'Test',sidecar:{}};
  expect(parseCustomNotebookTemplates([{filename:'../test.json',template},{filename:'test.html',template},{filename:'test.json',template:{...template,schema:'other'}}])).toEqual([]);
 });
 it('ignores malformed entries without dropping valid neighbours',()=>{
  expect(parseCustomNotebookTemplates([null,{filename:'ok.json',template:{schema:'kalamos.notes.template.v1',name:'Okay',sidecar:{}}}])).toHaveLength(1);
 });
});
