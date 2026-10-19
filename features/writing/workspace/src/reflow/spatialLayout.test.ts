import { describe, expect, it } from 'vitest';
import { condenseSpace, horizontalAnchor, horizontalSpace, verticalSpace, type SpatialAtom, type SpatialMetrics } from './spatialLayout';
const metrics: SpatialMetrics = { width: 800, lineHeight: 44, textGap: 16, inkGap: 16 };
const atom = (id: string, x: number, line = 0, width = 50, kind: SpatialAtom['kind'] = 'word'): SpatialAtom =>
  ({ id, x, y: line * 44 + (kind === 'ink' ? 5 : 0), line, width, height: kind === 'ink' ? 30 : 44, kind });
const x = (plan: ReturnType<typeof horizontalSpace>, id: string) => plan.positions.get(id)!.x;
const kinds = ['word', 'ink'] as const;
describe('horizontal collision pressure: independent product examples', () => {
  for (const a of kinds) for (const b of kinds) {
    it(`${a}/${b}: Hello uses spare room before X moves`, () => {
      const words = [atom('Hello', 100, 0, 50, a), atom('X', 500, 0, 30, b)];
      for (const [drag, expected] of [[100,500],[333,500],[334,500],[335,501],[400,566]])
        expect(x(horizontalSpace(words, 0, 100, drag, metrics), 'X')).toBe(expected);
    });
    it(`${a}/${b}: subtraction after X moves X back`, () => {
      const words = [atom('Hello', 100, 0, 50, a), atom('X', 500, 0, 30, b)];
      for (const contact of [530, 540]) {
        const result = horizontalSpace(words, 0, contact, -120, metrics);
        expect(x(result, 'Hello')).toBe(100); expect(x(result, 'X')).toBe(380);
        expect(horizontalAnchor(words, 0, contact)).toBe(contact);
      }
      const closed = horizontalSpace(words, 0, 530, -700, metrics);
      expect(x(closed, 'Hello')).toBeCloseTo(0);
      expect(x(closed, 'X')).toBeCloseTo(66); expect(closed.amount).toBeCloseTo(-434);
    });
  }
  it('A pushes B only as needed, and their remaining gap protects C', () => {
    const words = [atom('A',100),atom('B',180),atom('C',600)];
    const result = horizontalSpace(words,0,100,200,metrics);
    expect(words.map(w=>x(result,w.id))).toEqual([300,366,600]);
  });
  it('subtraction leaves words to the right of the caret alone', () => {
    const words = [atom('A',0),atom('B',200),atom('C',266),atom('D',600)];
    const result = horizontalSpace(words,0,250,-100,metrics);
    expect(words.map(w=>x(result,w.id))).toEqual([0,100,266,600]);
  });
  it('pre-existing tight text does not jump to a larger minimum gap', () => {
    const words = [atom('A',0),atom('B',54)], result=horizontalSpace(words,0,0,1,metrics);
    expect(words.map(w=>x(result,w.id))).toEqual([1,55]);
  });
  it('does not mutate the frozen baseline or pull up a deliberate following row', () => {
    const words=Object.freeze([Object.freeze(atom('A',100)),Object.freeze(atom('B',0,1))]);
    expect(horizontalSpace(words,0,100,10,metrics).positions.get('B')).toEqual({x:0,y:44,line:1});
    expect(words[0].x).toBe(100);
  });
  it('wraps whole words, pushes the next row and preserves ink vertical offsets', () => {
    const words=[atom('A',650,0,100,'ink'),atom('B',0,1),atom('C',600,1)];
    const result=horizontalSpace(words,0,650,100,metrics);
    expect(result.positions.get('A')).toEqual({x:0,y:49,line:1});
    expect(result.positions.get('B')).toEqual({x:116,y:44,line:1});
    expect(result.positions.get('C')).toEqual({x:600,y:44,line:1});
  });
  it('handles a large chain without recursion or lost identities', () => {
    const words=Array.from({length:3000},(_,i)=>atom(`w${i}`,(i%10)*70,Math.floor(i/10)));
    expect(horizontalSpace(words,0,0,700,metrics).positions.size).toBe(3000);
  });
  it('keeps an oversized indivisible word and its following content', () => {
    const result=horizontalSpace([atom('long',100,0,1000),atom('next',0,1)],0,100,20,metrics);
    expect(result.positions.get('long')).toEqual({x:0,y:44,line:1});
    expect(result.positions.get('next')!.line).toBe(2);
  });
});
describe('vertical rows and explicit controls',()=>{
  it('closes empty rows, stops at occupied rows, and preserves x',()=>{
    const result=verticalSpace([atom('heading',0),atom('Hello',100,3,50,'ink'),atom('X',500,3)],3,-3,metrics);
    expect(result.amount).toBe(-2);
    expect(result.positions.get('Hello')).toEqual({x:100,y:49,line:1});
    expect(result.positions.get('X')).toEqual({x:500,y:44,line:1});
    expect(result.positions.get('heading')).toEqual({x:0,y:0,line:0});
  });
  it('respects actual tall ink bounds as well as body rows',()=>{
    const tall={...atom('descender',100,0,50,'ink'),height:90};
    const result=verticalSpace([tall,atom('lower',100,3,50,'ink')],3,-3,metrics);
    // One row up would leave a two-pixel descender overlap.
    expect(result.amount).toBe(0);
    expect(result.positions.get('lower')!.y).toBeGreaterThanOrEqual(tall.y+tall.height);
  });
  it('keeps controls out of pressure, follows bound owners and shifts unbound row controls vertically',()=>{
    const words=[atom('task',100,2),{...atom('check',760,2,36,'control'),ownerId:'task'},atom('unbound',760,4,36,'control')];
    expect(horizontalSpace(words,2,100,100,metrics).positions.get('check')).toEqual({x:760,y:88,line:2});
    const result=verticalSpace(words,2,2,metrics);
    expect(result.positions.get('check')).toEqual({x:760,y:176,line:4});
    expect(result.positions.get('unbound')).toEqual({x:760,y:264,line:6});
  });
});
describe('condense policy',()=>{
  it('joins flow rows but preserves short rows and paragraph gaps',()=>{
    const result=condenseSpace([atom('A',20,2),atom('B',730,2),atom('C',20,3),atom('D',20,5)],metrics);
    expect(result.positions.get('C')!.line).toBe(0);expect(result.positions.get('D')!.line).toBe(1);
  });
  it('preserves explicit line breaks, indentation and control columns',()=>{
    const words=[atom('A',20,2),{...atom('B',60,3),breakBefore:1},{...atom('check',760,3,36,'control'),ownerId:'B'}];
    const result=condenseSpace(words,metrics);
    expect(result.positions.get('A')).toEqual({x:0,y:0,line:0});
    expect(result.positions.get('B')).toEqual({x:40,y:44,line:1});
    expect(result.positions.get('check')).toEqual({x:760,y:44,line:1});
  });
  it('is idempotent and conserves every atom',()=>{
    const words=[atom('A',100,2,50,'ink'),atom('B',700,2),{...atom('C',20,3),breakBefore:1}];
    const first=condenseSpace(words,metrics), materialized=words.map(w=>({...w,...first.positions.get(w.id)!}));
    expect(condenseSpace(materialized,metrics).positions).toEqual(first.positions);expect(first.positions.size).toBe(words.length);
  });
});

it('overflow preserves an explicit paragraph boundary by opening a row before it', () => {
  const words = [atom('A', 650, 0, 100, 'ink'), { ...atom('heading', 0, 1), breakBefore: 1 }, atom('body', 100, 2)];
  const result = horizontalSpace(words, 0, 650, 100, metrics);
  expect(result.positions.get('A')).toEqual({ x: 0, y: 49, line: 1 });
  expect(result.positions.get('heading')).toEqual({ x: 0, y: 88, line: 2 });
  expect(result.positions.get('body')).toEqual({ x: 100, y: 132, line: 3 });
});

describe('end-of-row caret belongs to the last content word', () => {
  for (const helloKind of kinds) for (const eggsKind of kinds) {
    it.each([410, 412, 500])(`${helloKind}/${eggsKind}: trailing contact %i closes eggs' leading gap without selecting a control`, contact => {
      const words = [atom('hello', 50, 2, 50, helloKind), atom('eggs', 350, 2, 60, eggsKind),
        atom('checkbox', 760, 2, 36, 'control'), atom('other-row', 100, 3)];
      const result = horizontalSpace(words, 2, contact, -80, metrics);
      expect(x(result, 'eggs')).toBe(270);
      for (const id of ['hello', 'checkbox', 'other-row']) expect(result.positions.get(id)).toEqual({
        x: words.find(w => w.id === id)!.x, y: words.find(w => w.id === id)!.y, line: words.find(w => w.id === id)!.line,
      });
      const closed = horizontalSpace(words, 2, contact, -800, metrics);
      expect(x(closed, 'eggs')).toBe(740);
      expect(closed.positions.get('eggs')!.line).toBe(1);
      expect(closed.positions.get('hello')!.line).toBe(1);
      expect(closed.amount).toBe(-800);
      expect(x(horizontalSpace(words, 2, contact, 40, metrics), 'eggs')).toBe(390);
      expect(horizontalSpace(words, 2, contact, 0, metrics).positions.get('eggs')!.x).toBe(350);
    });
  }
  it('an empty row or row containing only a control has no word target', () => {
    const words = [atom('checkbox', 760, 2, 36, 'control')];
    expect(horizontalSpace(words, 2, 700, -100, metrics).amount).toBe(0);
    expect(horizontalSpace(words, 1, 700, -100, metrics).amount).toBe(0);
  });
});

describe('signed pressure in both directions', () => {
  for (const leftKind of kinds) for (const seedKind of kinds) {
    it(`${leftKind}/${seedKind}: backward motion pushes the previous word only after consuming the gap`, () => {
      const atoms=[atom('left',100,0,50,leftKind),atom('seed',300,0,50,seedKind),atom('far',650)];
      expect(x(horizontalSpace(atoms,0,350,-100,metrics),'left')).toBe(100);
      const pressure=horizontalSpace(atoms,0,350,-200,metrics);
      expect(x(pressure,'seed')).toBeCloseTo(100);expect(x(pressure,'left')).toBeCloseTo(34);
      expect(x(pressure,'far')).toBe(650);
      expect(horizontalSpace(atoms,0,350,0,metrics).positions.get('left')!.x).toBe(100);
    });
  }
  it('wraps a whole word onto the previous row and pushes that row left', () => {
    const atoms=[atom('previous',700,0),atom('seed',20,1,60,'ink')];
    const p=horizontalSpace(atoms,1,80,-40,metrics);
    expect(p.positions.get('seed')).toEqual({x:740,y:5,line:0});
    expect(p.positions.get('previous')).toEqual({x:674,y:0,line:0});
    expect(atoms.map(a=>a.line)).toEqual([0,1]);
  });
  it('stops at the paragraph boundary without moving the preceding paragraph', () => {
    const atoms=[atom('heading',700,0),{...atom('first',100,1),breakBefore:1},atom('seed',300,1)];
    const p=horizontalSpace(atoms,1,350,-900,metrics);
    expect(p.positions.get('heading')).toEqual({x:700,y:0,line:0});
    expect(p.positions.get('first')!.x).toBeCloseTo(0);expect(p.positions.get('first')!.line).toBe(1);
    expect(p.positions.get('seed')!.x).toBeCloseTo(66);expect(p.positions.get('seed')!.line).toBe(1);
    expect(p.amount).toBeCloseTo(-234);
  });
  it('upward pressure pushes earlier occupied rows while preserving their x coordinates', () => {
    const atoms=[atom('upper',100,2),atom('seed',200,4),atom('suffix',500,6)];
    const p=verticalSpace(atoms,4,-3,metrics);
    expect(p.amount).toBe(-3);
    expect(p.positions.get('upper')).toEqual({x:100,y:0,line:0});
    expect(p.positions.get('seed')).toEqual({x:200,y:44,line:1});
    expect(p.positions.get('suffix')).toEqual({x:500,y:132,line:3});
    expect(verticalSpace(atoms,4,-100,metrics).amount).toBe(-3);
  });
  it('upward pressure keeps tall ink clear and follows attached checkboxes', () => {
    const atoms=[{...atom('tall',100,1,60,'ink'),height:75},atom('seed',100,4),
      {...atom('check',760,1,36,'control'),ownerId:'tall'}];
    const p=verticalSpace(atoms,4,-2,metrics);
    expect(p.positions.get('tall')).toEqual({x:100,y:5,line:0});
    expect(p.positions.get('seed')).toEqual({x:100,y:88,line:2});
    expect(p.positions.get('check')).toEqual({x:760,y:0,line:0});
    expect(p.positions.get('tall')!.y+75).toBeLessThanOrEqual(p.positions.get('seed')!.y);
  });
});


describe('caret divides backward and forward spacing',()=>{
  for(const leftKind of kinds) for(const rightKind of kinds) {
    it(`${leftKind}/${rightKind}: a caret in the gap moves only its chosen side`,()=>{
      const atoms=[atom('hello',100,1,50,leftKind),atom('world',300,1,50,rightKind)];
      for(const contact of [150,151,250,299,300]) {
        const left=horizontalSpace(atoms,1,contact,-20,metrics);
        expect(left.positions.get('hello')).toEqual({x:80,y:atoms[0].y,line:1});
        expect(left.positions.get('world')).toEqual({x:300,y:atoms[1].y,line:1});
        const right=horizontalSpace(atoms,1,contact,20,metrics);
        expect(right.positions.get('hello')).toEqual({x:100,y:atoms[0].y,line:1});
        expect(right.positions.get('world')).toEqual({x:320,y:atoms[1].y,line:1});
      }
      expect(horizontalSpace(atoms,1,99,-200,metrics).amount).toBe(0);
      const wrap=horizontalSpace(atoms,1,299,-200,metrics);
      expect(wrap.positions.get('hello')!.line).toBe(0);
      expect(wrap.positions.get('world')).toEqual({x:300,y:atoms[1].y,line:1});
    });
  }
});


it('a pen hit barely inside the right word cannot move it left of its snapped caret',()=>{
  // Device capture: pen 213.878, visible caret 212.720; solver previously used raw pen x.
  const atoms=[atom('left',23.445,4,104,'ink'),atom('right',212.720,4,97.6,'ink'),atom('later',332.720,4,68.8,'ink')];
  const caret=horizontalAnchor(atoms,4,213.878);
  expect(caret).toBe(212.720);
  for(const contact of [caret,213.878,260,310]) {
    const result=horizontalSpace(atoms,4,contact,-143.866,metrics);
    expect(result.positions.get('right')).toEqual({x:212.720,y:181,line:4});
    expect(result.positions.get('later')).toEqual({x:332.720,y:181,line:4});
    expect(result.positions.get('left')!.line).toBe(3);
  }
});
