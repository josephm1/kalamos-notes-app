import { describe, it, expect } from 'vitest';
import { wrapBoxText, fitBoxWidth, ruledTextSize, placeBoxWords, removeBoxWords } from './textBox';
it('fits short drafts, grows with content, and stops at the page edge', () => {
  const measure = (text: string) => Array.from(text).length * 8;
  expect(fitBoxWidth('', 300, measure)).toBe(64);
  expect(fitBoxWidth('Hello there', 300, measure)).toBe(96);
  expect(fitBoxWidth('A very long paragraph', 120, measure)).toBe(120);
  expect(fitBoxWidth('Hello there\nHi', 300, measure)).toBe(96);
});
describe('text box thumbnail wrapping', () => {
  it('retains newlines, spaces and Unicode when wrapping long content', () => {
    const lines = wrapBoxText('Plan  now\n\n😀😀😀', 4, s => Array.from(s).length);
    expect(lines).toEqual(['Plan', '  no', 'w', '', '😀😀😀']);
    expect(lines.every(s => Array.from(s).length <= 4)).toBe(true);
  });
});

it('scales type to saved ruling without changing its height', () => {
  expect(ruledTextSize(44)).toBe(27);
  expect(ruledTextSize(56)).toBe(35);
  expect(ruledTextSize(20)).toBe(19);
  expect(ruledTextSize(100)).toBe(42);
});

it('measures spaces and explicit blank lanes while retaining source ranges for long Unicode tokens',()=>{
 const text='A  B\n\n😀😀😀😀😀';
 const words=placeBoxWords(text,16,0,32,44,s=>Array.from(s).length*8,8);
 expect(words.map(w=>[w.text,w.x,w.y])).toEqual([['A',16,0],['B',40,0],['😀😀😀😀',16,88],['😀',16,132]]);
 expect(words.every(w=>text.slice(w.textStart,w.textEnd)===w.text)).toBe(true);
 const result=removeBoxWords(text,words,new Set([0,2]));
 expect(result.text).toBe('  B\n\n😀');
 expect(result.words.every(w=>result.text.slice(w.textStart,w.textEnd)===w.text)).toBe(true);
});
