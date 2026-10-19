import { beforeEach, describe, expect, it } from 'vitest';
import { scribble } from './scribble';
const stroke = (points: {x:number;y:number}[]) => ({ points, width: 2 });
const zigzag = Array.from({length:7}, (_,i) => ({x:i%2 ? 100 : 20,y:30+i*2}));
const old = [stroke([{x:55,y:15},{x:55,y:55}]),stroke([{x:120,y:15},{x:120,y:55}])];
beforeEach(() => scribble.setEnabled(true));
describe('conservative scribble geometry', () => {
  it('erases only repeatedly crossed paths, with a bounded refresh', () => {
    const result=scribble.detect(zigzag,old,44)!;
    expect(result.indices).toEqual([0]);
    expect(result.rect.x+result.rect.w).toBeLessThan(120);
  });
  it.each([0,Math.PI/4,Math.PI/2,Math.PI*0.7])('recognizes rotated gestures at %s radians', angle => {
    const rotate = (p:{x:number;y:number}) => ({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
    expect(scribble.detect(zigzag.map(rotate),old.map(s=>stroke(s.points.map(rotate))),44)?.indices).toEqual([0]);
  });
  it('works independently of point density, timestamps and drawing speed', () => {
    const dense=zigzag.flatMap((p,i)=>i ? Array.from({length:25},(_,j)=>({x:zigzag[i-1].x+(p.x-zigzag[i-1].x)*(j+1)/25,y:zigzag[i-1].y+(p.y-zigzag[i-1].y)*(j+1)/25})) : [p]);
    expect(scribble.detect(dense,old,44)?.indices).toEqual([0]);
  });
  it('does not erase uncrossed strokes inside the scribble bounding box', () => {
    const untouched=stroke([{x:30,y:38},{x:35,y:38}]);
    const open=zigzag.map((p,i)=>({...p,y:30+i*8}));
    expect(scribble.detect(open,[...old,untouched],44)?.indices).toEqual([0]);
  });
  it('leaves empty-space scribbles and disabled gestures as ink', () => {
    expect(scribble.detect(zigzag,[old[1]],44)).toBeNull();
    scribble.setEnabled(false);
    expect(scribble.detect(zigzag,old,44)).toBeNull();
  });
  it.each([
    ['underline', [{x:20,y:35},{x:100,y:35}]],
    ['crossbar', [{x:40,y:35},{x:80,y:35}]],
    ['dot', [{x:55,y:35}]],
    ['single back-and-forth',zigzag.slice(0,3)],
    ['forward cursive m/w',Array.from({length:20},(_,i)=>({x:20+i*4,y:30+(i%2)*20}))],
    ['repeated loops',Array.from({length:100},(_,i)=>({x:55+15*Math.cos(i*Math.PI/10),y:35+15*Math.sin(i*Math.PI/10)}))],
    ['jitter',Array.from({length:50},(_,i)=>({x:55+(i%2)*0.5,y:35+i*0.05}))],
    ['invalid',[{x:NaN,y:0},...zigzag]]
  ])('keeps %s as ordinary ink', (_,points) => expect(scribble.detect(points,old,44)).toBeNull());
});

describe('compact device-style scrubbing', () => {
  // Short local sweeps progress across the word instead of spanning its full width.
  const scrub = Array.from({length:27},(_,i)=>({x:20+i*2.5+(i%2?5:-5),y:35+(i%2?11:-11)}));
  const written = [stroke([{x:20,y:35},{x:100,y:35}]),stroke([{x:120,y:20},{x:120,y:50}])];
  it('recognizes dense progressive scribbling that the original wide-sweep rule rejected', () => {
    expect(scribble.detect(scrub,written,44)?.indices).toEqual([0]);
  });
  it.each([0,Math.PI/4,Math.PI/2])('handles compact scrubs rotated by %s', angle => {
    const rotate=(p:{x:number;y:number})=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
    expect(scribble.detect(scrub.map(rotate),written.map(s=>stroke(s.points.map(rotate))),44)?.indices).toEqual([0]);
  });
  it('keeps recognition after device quantization and Zoom coordinate mapping', () => {
    for (const scale of [1, 1.875, 2.5, 3]) {
      const sample = scrub.map(p => ({ x: Math.round(p.x*scale)/scale, y: Math.round(p.y*scale)/scale }));
      expect(scribble.detect(sample, written, 44)?.indices).toEqual([0]);
    }
  });
  it('rejects ordinary travelling waves and smooth looping over existing ink', () => {
    const cursive=Array.from({length:21},(_,i)=>({x:20+i*5,y:35+(i%2?10:-10)}));
    const loops=Array.from({length:250},(_,i)=>({x:40+i*.15+10*Math.cos(i*Math.PI/12),y:35+10*Math.sin(i*Math.PI/12)}));
    expect(scribble.detect(cursive,written,44)).toBeNull();
    expect(scribble.detect(loops,written,44)).toBeNull();
  });
  it('rejects dense small jitter and requires actual old ink contact', () => {
    const jitter=Array.from({length:200},(_,i)=>({x:20+i*.4,y:35+(i%2?.3:-.3)}));
    expect(scribble.detect(jitter,written,44)).toBeNull();
    expect(scribble.detect(scrub,[written[1]],44)).toBeNull();
  });
  const light = Array.from({length:9},(_,i)=>({x:20+i*5+(i%2?10:-10),y:35+(i%2?10:-10)}));
  it('recognizes fewer local passes without requiring a heavy dense scribble', () => {
    expect(scribble.detect(light,written,44)?.indices).toEqual([0]);
  });
  it.each([5,7,9])('recognizes %s-point scrubs in the density range rejected on device', count => {
    const points=Array.from({length:count},(_,i)=>({x:20+i*4+(i%2?8:-8),y:35+(i%2?8:-8)}));
    expect(scribble.detect(points,written,44)?.indices).toEqual([0]);
  });
  it.each([0,Math.PI/6,Math.PI/4,Math.PI*.8])('keeps minimum-pass recognition when rotated by %s', angle => {
    const rotate=(p:{x:number;y:number})=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
    const points=Array.from({length:7},(_,i)=>({x:20+i*4+(i%2?8:-8),y:35+(i%2?8:-8)}));
    expect(scribble.detect(points.map(rotate),written.map(s=>stroke(s.points.map(rotate))),44)?.indices).toEqual([0]);
  });
  it('accepts rounded scrub tips rather than requiring perfect sharp vertices', () => {
    const rounded=[light[0]];
    for(let i=1;i<light.length-1;i++) {
      const a={x:light[i].x*.9+light[i-1].x*.1,y:light[i].y*.9+light[i-1].y*.1};
      const b={x:light[i].x*.9+light[i+1].x*.1,y:light[i].y*.9+light[i+1].y*.1};
      for(let j=0;j<=8;j++) {
        const t=j/8,u=1-t;
        rounded.push({x:u*u*a.x+2*u*t*light[i].x+t*t*b.x,y:u*u*a.y+2*u*t*light[i].y+t*t*b.y});
      }
    }
    rounded.push(light[light.length-1]);
    expect(scribble.detect(rounded,written,44)?.indices).toEqual([0]);
  });
  it.each([Math.PI/6,Math.PI/2,Math.PI*.8])('recognizes lighter scrubs rotated by %s', angle => {
    const rotate=(p:{x:number;y:number})=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
    expect(scribble.detect(light.map(rotate),written.map(s=>stroke(s.points.map(rotate))),44)?.indices).toEqual([0]);
  });
  it('does not turn a short row of connected m/w letters into an erase', () => {
    const letters=Array.from({length:9},(_,i)=>({x:20+i*5,y:35+(i%2?10:-10)}));
    expect(scribble.detect(letters,written,44)).toBeNull();
  });
  it.each([Math.PI/6,Math.PI/2,Math.PI*.8])('protects rotated forward handwriting at %s', angle => {
    const rotate=(p:{x:number;y:number})=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
    const letters=Array.from({length:9},(_,i)=>({x:20+i*5,y:35+(i%2?10:-10)}));
    expect(scribble.detect(letters.map(rotate),written.map(s=>stroke(s.points.map(rotate))),44)).toBeNull();
  });
  it('handles duplicated samples and uneven sampling along lighter scrubs', () => {
    const sampled=light.flatMap((p,i)=> i ? Array.from({length:i%2?3:40},(_,j)=>({
      x:light[i-1].x+(p.x-light[i-1].x)*(j+1)/(i%2?3:40),
      y:light[i-1].y+(p.y-light[i-1].y)*(j+1)/(i%2?3:40),
    })).flatMap(p=>[p,p]) : [p,p]);
    expect(scribble.detect(sampled,written,44)?.indices).toEqual([0]);
  });
});


describe('lighter scribbles with word intent', () => {
  it.each([0,Math.PI/6,Math.PI/2])('accepts two broad cycles at angle %s', angle => {
    const rotate=(p:{x:number;y:number})=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
    expect(scribble.detect(zigzag.slice(0,5).map(rotate),old.map(s=>stroke(s.points.map(rotate))),44)?.indices).toEqual([0]);
  });
  it.each([5,7,9])('protects short forward letter waves (%s samples)', count => {
    const letters=Array.from({length:count},(_,i)=>({x:20+i*5,y:35+(i%2?10:-10)}));
    expect(scribble.detect(letters,old,44)).toBeNull();
  });
  it('ignores a briefly grazed neighbouring word, independently of sample density', () => {
    const words=[stroke([{x:40,y:10},{x:80,y:55}]),stroke([{x:110,y:10},{x:112,y:55}])];
    const points=[...zigzag,{x:114,y:43},{x:20,y:44},{x:114,y:45}];
    expect(scribble.detect(points,words,44)?.indices).toEqual([0,1]);
    expect(scribble.detect(points,words,44,[[0],[1]])?.indices).toEqual([0]);
    const dense=points.flatMap((p,i)=>i>6?Array(100).fill(p):[p]);
    expect(scribble.detect(dense,words,44,[[0],[1]])?.indices).toEqual([0]);
  });
  it('still erases two words when both are substantially scribbled over', () => {
    const words=[stroke([{x:45,y:15},{x:45,y:55}]),stroke([{x:75,y:15},{x:75,y:55}])];
    expect(scribble.detect(zigzag,words,44,[[0],[1]])?.indices).toEqual([0,1]);
  });
});


describe('low-effort erase gestures', () => {
  const short = zigzag.slice(0,4); // Three passes, two direction changes.
  it.each([0, Math.PI/4, Math.PI/2])('accepts three broad passes at angle %s', angle => {
    const rotate=(p:{x:number;y:number})=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
    expect(scribble.detect(short.map(rotate),old.map(s=>stroke(s.points.map(rotate))),44)?.indices).toEqual([0]);
  });
  it.each([0, Math.PI/4, Math.PI/2])('accepts a short shallow local scrub at angle %s', angle => {
    const rotate=(p:{x:number;y:number})=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
    // Previously rejected by the 2.7 travel/extent gate; four short overlapping
    // passes still retrace, unlike letters that advance continuously rightwards.
    const points=[{x:13,y:30},{x:31,y:40},{x:21,y:30},{x:39,y:40},{x:29,y:30}];
    const written=[stroke([{x:20,y:35},{x:100,y:35}])];
    expect(scribble.detect(points.map(rotate),written.map(s=>stroke(s.points.map(rotate))),44)?.indices).toEqual([0]);
  });
  it('keeps a single out-and-back as ink even with dense native samples', () => {
    const points=zigzag.slice(0,3).flatMap((p,i)=>i ? Array.from({length:40},(_,j)=>({x:zigzag[i-1].x+(p.x-zigzag[i-1].x)*(j+1)/40,y:zigzag[i-1].y+(p.y-zigzag[i-1].y)*(j+1)/40})):[p]);
    expect(scribble.detect(points,old,44)).toBeNull();
  });
  it('protects a Z with separated upper and lower crossbars', () => {
    const z=[{x:20,y:20},{x:100,y:20},{x:20,y:55},{x:100,y:55}];
    expect(scribble.detect(z,old,44)).toBeNull();
  });
  it('accepts modest forward drift without needing a prolonged scrub', () => {
    const points=[{x:15,y:22},{x:34,y:48},{x:33,y:22},{x:52,y:48},{x:51,y:22},{x:70,y:48},{x:69,y:22}];
    expect(scribble.detect(points,[stroke([{x:10,y:35},{x:120,y:35}])],44)?.indices).toEqual([0]);
  });
  it('retains neighbour intent filtering with the shorter gesture', () => {
    const words=[stroke([{x:40,y:10},{x:80,y:55}]),stroke([{x:98,y:10},{x:100,y:55}])];
    expect(scribble.detect(short,words,44,[[0],[1]])?.indices).toEqual([0]);
  });
});
