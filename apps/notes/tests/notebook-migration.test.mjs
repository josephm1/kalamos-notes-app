import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app/src/main/assets/web/js/notebook-migration.js',import.meta.url),'utf8');
function fixture(fail='') {
  let meta={notebookId:'n',title:'Legacy',pages:[{pageId:'p1',strokes:null},{pageId:'p2',strokes:null}]};
  const originals=JSON.stringify(meta), files=new Map(),writes=[];
  const strokes=[{width:2,points:[{x:300,y:150}]}];
  const window={KalamosWriteWorkspace:{convertLegacyPage(p){if(!Array.isArray(p.strokes)) throw Error('Invalid');return {source:'paper',sidecar:{inkRuns:p.strokes}}}}};
  const Bridge={loadMeta:()=>JSON.stringify(meta),getNotebookFile:(_,f)=>files.get(f)||'',saveNotebookFile(_,f,s){writes.push(f);if(f===fail)return 'error';files.set(f,s);return 'ok'}};
  const Storage={loadMeta:()=>structuredClone(meta),loadPageRaw:()=>JSON.stringify(strokes),saveNotebook(n){writes.push('meta');if(fail==='meta')return false;meta=structuredClone(n);return true}};
  vm.runInNewContext(source,{window,Bridge,Storage,console:{info(){}}});
  return {ensure:()=>window.KalamosNotesMigration.ensure('n'),files,writes,meta:()=>meta,originals};
}
test('backup and every sheet precede index and discriminator commit',()=>{
  const f=fixture();f.ensure();assert.equal(f.writes[0],'handwriting.backup.json');
  assert.deepEqual(f.writes.slice(-2),['planning.pages.json','meta']);
  assert.equal(f.meta().kind,'planning');
  assert.equal(JSON.stringify(JSON.parse(f.files.get('handwriting.backup.json')).meta),f.originals);
  const count=f.writes.length;f.ensure();assert.equal(f.writes.length,count,'reopen cannot overwrite edited ruled pages');
});
for(const fail of ['handwriting.backup.json','planning.page-legacy1.json','planning.pages.json','meta']) {
  test('failed '+fail+' retains legacy metadata and allows safe retry',()=>{
    const f=fixture(fail);assert.throws(f.ensure);assert.equal(JSON.stringify(f.meta()),f.originals);
    assert.ok(!f.writes.includes('meta')||fail==='meta');
  });
}
