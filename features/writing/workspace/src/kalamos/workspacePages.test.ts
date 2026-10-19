import { expect, it } from 'vitest';
import { appendPage, initialPages, parsePages } from './workspacePages';
it('reopens old notebooks using their existing first-sheet files', () => {
  expect(parsePages('')).toEqual(initialPages());
});
it('adds independent source/ink files and restores the selected sheet', () => {
  const first = initialPages(), second = appendPage(first, 'p2'), third = appendPage(second, 'p3');
  expect(first.pages).toHaveLength(1);
  expect(third.active).toBe(2);
  expect(new Set(third.pages.map(p=>p.sidecarFile)).size).toBe(3);
  expect(parsePages(JSON.stringify(third))).toEqual(third);
  expect(parsePages(JSON.stringify({...third,active:10})).active).toBe(2);
});
it('rejects corrupt manifests and unsafe page paths instead of replacing the notebook', () => {
  expect(()=>parsePages('{')).toThrow();
  expect(()=>parsePages(JSON.stringify({...initialPages(),pages:[]}))).toThrow();
  expect(()=>appendPage(initialPages(),'../other')).toThrow();
  expect(()=>parsePages(JSON.stringify({...initialPages(),pages:[{id:'first',sourceFile:'../other.md',sidecarFile:'planning.write2.json'}]}))).toThrow();
});

it('retains the chosen starter on new sheets without copying completed tasks',()=>{
  const index = {...initialPages(),template:'tasks' as const};
  const next = appendPage(index,'new');
  expect(parsePages(JSON.stringify(next)).template).toBe('tasks');
  expect(next.pages[1].sidecarFile).not.toBe(next.pages[0].sidecarFile);
  expect(parsePages(JSON.stringify({...index,template:'invalid'})).template).toBeUndefined();
});
