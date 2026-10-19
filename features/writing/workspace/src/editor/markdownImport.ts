import { markdownHtmlText } from "./markdownHtml";
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Definition, Nodes, PhrasingContent, Root, RootContent } from 'mdast';
import { normalizeCheckboxNodes } from './checkboxMarkdown';
import { semanticBlocksFromMarkdownTree } from './markdownTranscription';
import type { SemanticBlock } from './semanticDocument';

/** One explicit capability dispatch, never a failed parse converted into a different document.
 * Editable prose/list nodes share the AI parser. Code, tables, quotations and rich inline
 * content have a read-only representation with their exact source retained for export.
 */
export function markdownImportBlocks(source:string,columns=48):SemanticBlock[] {
  if(!source.trim()||source.includes('\0')||source.length>1_048_576)throw Error('Choose a non-empty Markdown document up to 1 MB.');
  if(!Number.isInteger(columns)||columns<8||columns>1000)throw Error('Invalid Markdown display width.');
  const root=unified().use(remarkParse).use(remarkGfm).parse(source) as Root;
  normalizeCheckboxNodes(root);
  const definitions=new Map(root.children.filter((node):node is Definition=>node.type==='definition').map(node=>[node.identifier.toLowerCase(),node]));
  const raw=(node:Nodes)=>source.slice(node.position!.start.offset!,node.position!.end.offset!);
  const reference=(node:{identifier:string})=>{
    const value=definitions.get(node.identifier.toLowerCase());
    if(!value)throw Error(`Markdown reference is unavailable: ${node.identifier}`);
    return value;
  };
  const inline=(nodes:PhrasingContent[]):string=>nodes.map(node=>{
    switch(node.type) {
      case 'text':case 'inlineCode':return node.value;
      case 'break':return '\n';
      case 'html':return markdownHtmlText(node.value);
      case 'strong':case 'emphasis':case 'delete':case 'link':return inline(node.children);
      case 'linkReference':reference(node);return inline(node.children);
      case 'image':return `Image: ${node.alt||node.url}`;
      case 'imageReference':return `Image: ${node.alt||reference(node).url}`;
      default:throw Error(`Unsupported Markdown inline content: ${node.type}`);
    }
  }).join('');
  // Validate every descendant before materialization, including table cells/list bodies.
  // Only enumerated Markdown nodes are accepted; arbitrary HTML is not a preview type.
  const readOnly=(node:Nodes):boolean=>{
    switch(node.type) {
      case 'text':case 'break':return false;
      case 'inlineCode':return false;
      case 'image':case 'definition':return true;
      case 'imageReference':reference(node);return true;
      case 'linkReference':reference(node);return node.children.some(readOnly);
      case 'link':return node.children.some(readOnly);
      case 'code':case 'thematicBreak':return true;
      case 'html':markdownHtmlText(node.value);return true;
      case 'table':case 'blockquote':node.children.forEach(readOnly);return true;
      case 'root':case 'heading':case 'paragraph':case 'strong':case 'emphasis':case 'delete':case 'list':case 'listItem':case 'tableRow':case 'tableCell': {
        const children=node.children.map(readOnly);return children.some(Boolean);
      }
      default:throw Error(`Unsupported Markdown content: ${node.type}`);
    }
  };
  const wrap=(line:string,width:number):string[]=>{
    if(!line)return [''];const result:string[]=[];
    while(line.length>width){let end=line.lastIndexOf(' ',width);if(end<Math.floor(width/2))end=width;result.push(line.slice(0,end));line=line.slice(end).replace(/^ /,'');}
    result.push(line);return result;
  };
  const render=(node:RootContent,width=columns):string[]=>{
    switch(node.type) {
      case 'html':return markdownHtmlText(node.value).split('\n').flatMap(line=>wrap(line,width));
      case 'paragraph':case 'heading':return inline(node.children).split('\n').flatMap(line=>wrap(line,width));
      case 'code':return node.value.split('\n').flatMap(line=>wrap(line,width));
      case 'table': {
        const count=Math.max(1,...node.children.map(row=>row.children.length));
        const cellWidth=Math.max(1,Math.floor((width-(count-1)*3)/count));
        // Wide tables retain every cell in labelled rows rather than clipping later columns.
        if(count*8+(count-1)*3>width) {
          const headers=node.children[0]?.children.map(cell=>inline(cell.children))??[];
          if(node.children.length===1)return headers.flatMap(header=>wrap(header,width));
          return node.children.slice(1).flatMap((row,index)=>[
            ...(index?['']:[]),...row.children.flatMap((cell,column)=>wrap(`${headers[column]||`Column ${column+1}`}: ${inline(cell.children)}`,width)),
          ]);
        }
        const lines:string[]=[];
        node.children.forEach((row,rowIndex)=>{
          const cells=row.children.map(cell=>inline(cell.children).split('\n').flatMap(line=>wrap(line,cellWidth)));
          const height=Math.max(1,...cells.map(cell=>cell.length));
          for(let line=0;line<height;line++)lines.push(Array.from({length:count},(_,column)=>(cells[column]?.[line]??'').padEnd(cellWidth)).join(' │ '));
          if(rowIndex===0)lines.push(Array.from({length:count},()=> '─'.repeat(cellWidth)).join('─┼─'));
        });
        return lines;
      }
      case 'blockquote':return node.children.flatMap(child=>render(child,Math.max(4,width-2)).map(line=>'│ '+line));
      case 'thematicBreak':return ['─'.repeat(Math.min(width,32))];
      case 'list':return node.children.flatMap((item,index)=>{
        const marker=typeof item.checked==='boolean'?`[${item.checked?'x':' '}] `:node.ordered?`${(node.start??1)+index}. `:'• ';
        const body=item.children.flatMap(child=>render(child,Math.max(4,width-marker.length)));
        return body.map((line,index)=>(index?' '.repeat(marker.length):marker)+line);
      });
      case 'definition':return wrap(`[${node.label??node.identifier}]: ${node.url}`,width);
      default:throw Error(`Unsupported Markdown content: ${node.type}`);
    }
  };
  const blocks:SemanticBlock[]=[];
  const usedDefinitions=new Set<string>();
  const referencedDefinitions=(node:Nodes):Definition[]=>{
    const result:Definition[]=[];
    const visit=(value:Nodes)=>{
      if(value.type==='linkReference'||value.type==='imageReference') {
        const definition=reference(value);
        usedDefinitions.add(definition.identifier.toLowerCase());
        if(!result.includes(definition))result.push(definition);
      }
      if('children' in value)value.children.forEach(visit);
    };
    visit(node);return result;
  };
  // Resolve references before dropping definition-only blocks from the visible layout.
  root.children.forEach(referencedDefinitions);
  for(const [index,node] of root.children.entries()) {
    if(node.type==='definition'&&usedDefinitions.has(node.identifier.toLowerCase()))continue;
    if(!readOnly(node)) {
      const resolve=(value:Nodes):void=>{
        if('children' in value)value.children=value.children.map(child=>{
          if(child.type==='linkReference'){const ref=reference(child);return {type:'link',url:ref.url,title:ref.title,children:child.children,position:child.position};}
          resolve(child);return child;
        }) as typeof value.children;
      };
      resolve(node);
      const parsed=semanticBlocksFromMarkdownTree({type:'root',children:[node]},source,false,true);
      const ids=new Map(parsed.map(block=>[block.id,`import-${index}-${block.id}`]));
      blocks.push(...parsed.map(block=>({...block,id:ids.get(block.id)!,...(block.parentId?{parentId:ids.get(block.parentId)!}:{})})));
    } else {
      const lines=render(node);
      const markdown=[raw(node),...referencedDefinitions(node).map(raw)].join('\n\n');
      blocks.push({id:`import-preview-${index}`,type:'paragraph',text:'',preview:{source:markdown,lines:lines.length?lines:['']}});
    }
  }
  if(!blocks.length)throw Error('No visible Markdown content.');
  return blocks;
}
