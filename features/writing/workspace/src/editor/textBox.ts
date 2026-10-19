import { styledFragments, clipInlineStyles, deleteInlineStyles, type InlineStyle } from './inlineStyles';
/** Match the annotation's pre-wrap/anywhere DOM wrapping in the model thumbnail. */
export function wrapBoxText(text: string, width: number, measure: (text: string) => number): string[] {
  return text.split('\n').flatMap(paragraph => {
    const lines: string[] = [];
    let line = '';
    for (const char of Array.from(paragraph)) {
      if (line && measure(line + char) > width) { lines.push(line); line = ''; }
      line += char;
    }
    lines.push(line);
    return lines;
  });
}

/** UTF-16 ranges refer to the authoritative text, including across visual wraps. */
export type BoxWord = { text: string; x: number; y: number; breakBefore?: number; textStart?: number; textEnd?: number };
export const WORKSPACE_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export function resolveRuledLineHeight(saved: number | undefined, words: {y:number}[] | undefined, fallback: number): number {
  const ys = words?.map(w => w.y).filter(y => y > 0) ?? [];
  return saved ?? (ys.length ? [44,56].find(h => ys.every(y => Math.abs(y/h-Math.round(y/h)) < .001)) : undefined) ?? fallback;
}
/** Whole words use measured ruled lanes. Only overlong tokens split, retaining exact source ranges. */
export function placeBoxWords(text: string, x: number, y: number, width: number, lineHeight: number, measure: (text: string) => number, space: number, measureRange?: (text:string,start:number)=>number): BoxWord[] {
  const placed: BoxWord[] = [], startX = Math.max(0,x), limit = Math.max(1,width);
  let cursor=startX, line=Math.max(0,Math.round(y/lineHeight)), breaks=0;
  for (const token of text.matchAll(/\s+|\S+/gu)) {
    if (/^\s/u.test(token[0])) {
      let offset=token.index!;
      for (const c of token[0]) {
        if(c==='\n'){line++;cursor=startX;breaks++;}
        else if(c!=='\r')cursor+=c==='\t'?space*4:(measureRange?.(c,offset)??space);
        offset+=c.length;
      }
      continue;
    }
    const value=token[0], start=token.index!;
    if(cursor>startX && cursor+(measureRange?.(value,start)??measure(value))>startX+limit){line++;cursor=startX;}
    let fragment='', offset=start;
    const emit=()=>{
      if(!fragment)return;
      placed.push({text:fragment,x:cursor,y:line*lineHeight,textStart:offset,textEnd:offset+fragment.length,...(breaks?{breakBefore:breaks}:{})});
      cursor+=measureRange?.(fragment,offset)??measure(fragment);offset+=fragment.length;fragment='';breaks=0;
    };
    for(const char of Array.from(value)){
      if(fragment && (measureRange?.(fragment+char,offset)??measure(fragment+char))>limit){emit();line++;cursor=startX;}
      fragment+=char;
    }
    emit();
  }
  return placed;
}
/** Older sidecars lack ranges; derive them only from an exact, ordered text match. */
export function withWordRanges(text:string,words:BoxWord[]):BoxWord[]{
  let cursor=0;
  return words.map(word=>{
    const valid=Number.isInteger(word.textStart)&&Number.isInteger(word.textEnd)&&word.textStart!>=cursor&&text.slice(word.textStart,word.textEnd)===word.text;
    const start=valid?word.textStart!:text.indexOf(word.text,cursor);
    if(start<0)return {...word,textStart:undefined,textEnd:undefined};
    cursor=start+word.text.length;return {...word,textStart:start,textEnd:cursor};
  });
}
/** Keep surviving positions and exact whitespace when a gesture deletes visible typed tokens. */
export function removeBoxWords(text:string,words:BoxWord[],indices:Set<number>,styles?:InlineStyle[]):{text:string;words:BoxWord[];styles?:InlineStyle[]}{
  const ranged=withWordRanges(text,words);
  const removed=ranged.filter((_,i)=>indices.has(i));
  if(styles?.length&&removed.some(w=>w.textStart===undefined))throw Error('Styled word ranges are unavailable');
  if(removed.some(w=>w.textStart===undefined))return {text:ranged.filter((_,i)=>!indices.has(i)).map(w=>w.text).join(' '),words:ranged.filter((_,i)=>!indices.has(i)).map(w=>({...w,textStart:undefined,textEnd:undefined}))};
  let next=text;
  for(const word of [...removed].reverse())next=next.slice(0,word.textStart)+next.slice(word.textEnd);
  const marks=styles?.length?deleteInlineStyles(text,styles,removed.map(w=>({start:w.textStart!,end:w.textEnd!}))).styles:undefined;
  return {text:next,...(styles?{styles:marks??[]}:{}),words:ranged.flatMap((word,i)=>{
    if(indices.has(i))return [];
    const delta=removed.filter(w=>w.textEnd!<=word.textStart!).reduce((n,w)=>n+w.text.length,0);
    return [{...word,...(word.textStart!==undefined?{textStart:word.textStart-delta,textEnd:word.textEnd!-delta}:{})}];
  })};
}
/** Contiguous pagination pieces own surrounding whitespace; joining pieces is byte-preserving. */
export function sliceBoxWords(text:string,words:BoxWord[],first:number,end:number,styles?:InlineStyle[]):{text:string;words:BoxWord[];styles?:InlineStyle[]}{
  const ranged=withWordRanges(text,words);
  const start=first===0?0:ranged[first].textStart;
  const stop=end===ranged.length?text.length:ranged[end].textStart;
  if(start===undefined||stop===undefined)return {text:ranged.slice(first,end).map(w=>w.text).join(' '),words:ranged.slice(first,end)};
  return {text:text.slice(start,stop),...(styles?{styles:clipInlineStyles(styles,start,stop)}:{}),words:ranged.slice(first,end).map(w=>({...w,textStart:w.textStart! - start,textEnd:w.textEnd! - start}))};
}
/** Fit a short draft rather than covering a fixed-width strip of the page. */
export function fitBoxWidth(text: string, available: number, measure: (text: string) => number): number {
  return Math.min(Math.max(1, available), Math.max(64, ...text.split('\n').map(line => measure(line) + 8)));
}

/** Keep type proportional to the saved ruling, without changing notebook geometry. */
export function ruledTextSize(lineHeight: number): number {
  return Math.max(19, Math.min(42, Math.round(lineHeight * 0.62)));
}

/** Style is derived from the typed element, shared by measurement and all renderers. */
export function ruledTextFont(lineHeight:number, type?:string):string {
  return `${type==='heading'?'700 ':''}${ruledTextSize(lineHeight)}px ${WORKSPACE_FONT_FAMILY}`;
}

/** One logical word remains one gesture target, even when marks change mid-word. */
export function measureStyledText(text:string,styles:InlineStyle[]|undefined,start:number,end:number,measure:(text:string,style:InlineStyle)=>number):number {
 return styledFragments(text,styles??[],start,end).reduce((sum,run)=>sum+measure(run.text,run),0);
}
