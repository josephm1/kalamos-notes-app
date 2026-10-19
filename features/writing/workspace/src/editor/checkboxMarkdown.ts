import type { ListItem, Nodes, Root } from 'mdast';

/** HTML is never rendered. A complete, inert input tag has only checkbox metadata. */
function checkboxState(value:string):boolean|undefined {
  const tag=/^<input\b([^<>]*)\/?\s*>$/i.exec(value.trim());
  if(!tag)return undefined;
  const attributes=new Map<string,string>();
  let rest=tag[1].trim().replace(/\/$/,'').trim();
  while(rest) {
    const match=/^([a-z][a-z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?(?:\s+|$)/i.exec(rest);
    if(!match||attributes.has(match[1].toLowerCase()))return undefined;
    attributes.set(match[1].toLowerCase(),match[2]??match[3]??match[4]??'');
    rest=rest.slice(match[0].length);
  }
  if(attributes.get('type')?.toLowerCase()!=='checkbox'||[...attributes.keys()].some(name=>!['type','checked','disabled'].includes(name)))return undefined;
  // checked is an HTML boolean attribute: its presence, including checked="false",
  // means checked. Never invent a different state by interpreting the attribute value.
  return attributes.has('checked');
}

export function isMarkdownComment(value:string):boolean {
  return /^\s*(?:<!--[\s\S]*?-->\s*)+$/.test(value);
}

/** Normalize only parsed HTML nodes, with ownership determined by the Markdown list AST.
 * Source text/code and sibling/nested list owners are never searched or rewritten.
 * The caller owns this freshly parsed tree; unsupported HTML stays for strict rejection.
 */
export function normalizeCheckboxNodes(root:Root):void {
  const visit=(node:Nodes,owner?:ListItem)=>{
    if(!('children' in node))return;
    const item=node.type==='listItem'?node:owner;
    let controls=0;
    const clean=(current:Nodes):void=>{
      if(!('children' in current))return;
      current.children=current.children.filter(child=>{
        if(child.type!=='html')return true;
        if(isMarkdownComment(child.value))return false;
        const checked=checkboxState(child.value);
        if(checked===undefined||!item)return true;
        if(++controls>1)throw Error('A Markdown list item contains multiple checkboxes.');
        if(typeof item.checked==='boolean'&&item.checked!==checked)throw Error('A Markdown list item contains conflicting checkbox states.');
        item.checked=checked;
        return false;
      }) as typeof current.children;
      for(const child of current.children) {
        if(child.type==='list'||child.type==='listItem')visit(child);
        else clean(child);
      }
    };
    // Each list item has one counter. Descendant lists start their own owners.
    if(node.type==='listItem') {
      clean(node);
      for(const paragraph of node.children)if(paragraph.type==='paragraph') {
        const first=paragraph.children[0],last=paragraph.children[paragraph.children.length-1];
        if(controls&&first?.type==='text')first.value=first.value.replace(/^\s+/,'');
        if(controls&&last?.type==='text')last.value=last.value.replace(/\s+$/,'');
        paragraph.children=paragraph.children.filter(child=>child.type!=='text'||child.value.length>0);
      }
      node.children=node.children.filter(child=>child.type!=='paragraph'||child.children.length>0);
    } else {
      node.children=node.children.filter(child=>child.type!=='html'||!isMarkdownComment(child.value)) as typeof node.children;
      for(const child of node.children)visit(child,item);
    }
  };
  visit(root);
}
