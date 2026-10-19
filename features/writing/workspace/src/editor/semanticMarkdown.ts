import { serializeInlineMarkdown } from './inlineStyles';
import type { SemanticBlock } from './semanticDocument';
import { semanticOrder } from './semanticHierarchy';

/** A readable interchange view, never the owner of element identity or live task state. */
export function semanticBlocksToMarkdown(blocks: SemanticBlock[]): string {
  let number = 0;
  const ordered = semanticOrder(blocks);
  const byId=new Map(blocks.map(block=>[block.id,block]));
  const ancestors=(block:SemanticBlock)=>{
    const result:SemanticBlock[]=[];let parent=block.parentId;
    while(parent){const owner=byId.get(parent)!;result.push(owner);parent=owner.parentId;}
    return result;
  };
  const escape = (text: string) => text.replace(/[\\`*_{}\[\]<>#!|~]/g, '\\$&');
  return ordered.map(block => {
    const text = block.styles?.length?serializeInlineMarkdown(block.text,block.styles):escape(block.text);
    switch (block.type) {
      case 'heading': return '#'.repeat(1+ancestors(block).filter(parent=>parent.type==='heading').length)+' ' + text.replace(/\n/g, ' ');
      case 'task': return `- [${block.checked ? 'x' : ' '}] ${text.replace(/\n/g, '\n  ')}`;
      case 'bullet': return '- ' + text.replace(/\n/g, '\n  ');
      case 'numbered': return `${block.ordinal??++number}. ${text.replace(/\n/g, '\n   ')}`;
      case 'paragraph': return text;
    }
  }).map((text,index)=>{
    // Headings define sections; only list-item ancestors indent list content.
    // Indenting tasks under headings turns them into Markdown code blocks.
    const indent=ancestors(ordered[index]).filter(parent=>['task','bullet','numbered'].includes(parent.type)).length;
    return text.split('\n').map(line=>'  '.repeat(indent)+line).join('\n');
  }).join('\n\n') + '\n';
}
