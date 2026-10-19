/** Inert readable HTML vocabulary used by Markdown authors. No browser HTML is mounted. */
const tags=new Set(['sub','sup','kbd','details','summary','br','p','div','span','strong','b','em','i','s','del','code','pre']);
export function markdownHtmlText(source:string):string {
  const tree=new DOMParser().parseFromString(source,'text/html');
  const visit=(node:Node):string=>{
    if(node.nodeType===Node.TEXT_NODE)return node.textContent??'';
    if(node.nodeType===Node.COMMENT_NODE)return '';
    if(node.nodeType!==Node.ELEMENT_NODE)return [...node.childNodes].map(visit).join('');
    const element=node as Element,name=element.tagName.toLowerCase();
    if(!tags.has(name))throw Error(`Unsupported Markdown HTML element: ${name}`);
    for(const attribute of [...element.attributes])if(!(name==='details'&&attribute.name==='open'))throw Error(`Unsupported Markdown HTML attribute: ${attribute.name}`);
    const content=[...node.childNodes].map(visit).join('');
    return name==='br'?'\n':['p','div','summary','pre'].includes(name)?content+'\n':content;
  };
  // DOMParser relocates scripts/style into head; validate both, never discard executable nodes.
  [...tree.head.childNodes].forEach(visit);
  return [...tree.body.childNodes].map(visit).join('');
}
