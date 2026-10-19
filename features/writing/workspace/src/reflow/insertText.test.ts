import { describe, expect, it } from 'vitest';
import { insertTextFlow } from './insertText';

const item = (id: string, line: number, x: number, width: number, order = 0) => ({ id, line, x, width, order });
const space = () => 5;
describe('typed insertion into mixed ruled flow', () => {
  it('leaves preceding words fixed and consumes existing whitespace before moving a suffix', () => {
    const left = item('left', 0, 0, 20), right = item('right', 0, 100, 20);
    const text = item('typed', 0, 40, 30);
    const plan = insertTextFlow([text], [left, right], 200, space);
    expect(plan.find(p => p.item === left)).toBeUndefined();
    expect(plan.find(p => p.item === right)).toMatchObject({ line: 0, x: 100 });
  });
  it('moves a colliding whole word, and cascades overflow before lower-row content', () => {
    const text = item('typed', 0, 40, 30);
    const ink = item('ink', 0, 60, 40), below = item('below', 1, 0, 35);
    const plan = insertTextFlow([text], [ink, below], 100, space);
    expect(plan.find(p => p.item === ink)).toMatchObject({ line: 1, x: 0 });
    expect(plan.find(p => p.item === below)).toMatchObject({ line: 1, x: 45 });
    expect(ink).toEqual(item('ink', 0, 60, 40));
  });
  it('only snaps near a boundary and preserves deeper word drops', () => {
    const ink = item('ink', 0, 40, 40);
    const before = insertTextFlow([item('typed', 0, 42, 20)], [ink], 200, space);
    expect(before[0]).toMatchObject({ x: 35 });
    expect(before.find(p => p.item === ink)).toMatchObject({ x: 60 });
    const after = insertTextFlow([item('typed', 0, 78, 20)], [ink], 200, space);
    expect(after[0]).toMatchObject({ x: 85 });
    expect(after.find(p => p.item === ink)).toBeUndefined();
    const middle = insertTextFlow([item('typed', 0, 60, 20)], [ink], 200, space);
    expect(middle[0]).toMatchObject({ x: 60 });
    expect(middle.find(p => p.item === ink)).toMatchObject({ x: 85 });
  });
  it('keeps multiline incoming words in reading order when an earlier row wraps', () => {
    const a = item('a', 0, 60, 30, 0), b = item('b', 0, 95, 30, 1), c = item('c', 1, 0, 30, 2);
    const plan = insertTextFlow([a, b, c], [], 100, space);
    const position = (word: typeof a) => { const p = plan.find(p => p.item === word)!; return p.line * 100 + p.x; };
    expect(position(a)).toBeLessThan(position(b));
    expect(position(b)).toBeLessThan(position(c));
  });
  it('preserves explicit paragraph and blank-line breaks after overflow', () => {
    const a = item('a', 0, 60, 30, 0), b = item('b', 0, 95, 30, 1);
    const c = { ...item('c', 2, 0, 30, 2), breakBefore: 2 };
    const plan = insertTextFlow([a, b, c], [], 100, space);
    expect(plan.find(p => p.item === b)).toMatchObject({ line: 1 });
    expect(plan.find(p => p.item === c)).toMatchObject({ line: 3 });
  });
});

it('keeps the insertion column when typed words carry onto another ruled row', () => {
  const a = item('a', 0, 40, 30), b = item('b', 0, 75, 30, 1);
  const plan = insertTextFlow([a, b], [], 100, space);
  expect(plan.find(p => p.item === a)).toMatchObject({line:0,x:40});
  expect(plan.find(p => p.item === b)).toMatchObject({line:1,x:40});
});
