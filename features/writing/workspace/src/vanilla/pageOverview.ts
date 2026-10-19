import { inkToolIcon } from './inkToolIcons';
import { bindPenButton } from './penButton';
export type OverviewPage={id:string;svg?:string;cover:boolean};
export type OverviewAction='copy'|'left'|'right'|'move'|'cover'|'delete'|'copyTo';
export type OverviewAdapter={
 load():Promise<{pages:OverviewPage[];active:number}>;
 mutate(action:OverviewAction,ids:string[],value?:string):Promise<void>;
 open(index:number):void|Promise<void>;
 close():void|Promise<void>;
 preview?(id:string):Promise<string>;
 destinations():{id:string;title:string}[];
};
/** Page selection is transient; the adapter owns checkpoints and manifest publication. */
export function showPageOverview(root:HTMLElement,adapter:OverviewAdapter){
 if(root.querySelector('.rw-page-overview'))return;
 const previous=document.activeElement as HTMLElement|null;
 const panel=document.createElement('section');panel.className='rw-page-overview';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Page overview');panel.tabIndex=-1;
 const header=document.createElement('div');header.className='rw-page-actions';
 const grid=document.createElement('div');grid.className='rw-page-grid';grid.setAttribute('aria-label','Notebook pages');
 const footer=document.createElement('div');footer.className='rw-page-footer';
 const status=document.createElement('div');status.className='rw-page-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const summary=document.createElement('p');summary.className='rw-page-summary';
 let data:{pages:OverviewPage[];active:number}={pages:[],active:0},selected=new Set<string>(),batch=0,busy=false,loading=true,closed=false;
 let density=4;
 try{const saved=Number(localStorage.getItem('notes.pageOverviewDensity'));if([4,9,16].includes(saved))density=saved;}catch{/* optional UI preference */}
 const button=(label:string,icon:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);b.innerHTML=inkToolIcon(icon);const text=document.createElement('span');text.textContent=label;b.append(text);bindPenButton(b,action);return b;};
 const fail=(error:unknown)=>{status.textContent=error instanceof Error?error.message:String(error);status.setAttribute('role','alert');};
 const finish=async(index?:number)=>{if(busy||closed)return;closed=true;panel.remove();try{if(index===undefined)await adapter.close();else await adapter.open(index);}catch(error){console.warn('[notes-pages] overview return failed',error);}finally{if(previous?.isConnected)previous.focus();}};
 const perform=async(action:OverviewAction,value?:string)=>{if(busy||loading||!selected.size)return;busy=true;status.textContent='Updating pages…';status.setAttribute('role','status');render();try{await adapter.mutate(action,[...selected],value);await refresh();status.textContent='';}catch(e){fail(e);}finally{busy=false;render();}};
 const choose=(action:'copyTo'|'move')=>{
  if(busy||loading||!selected.size)return;
  panel.querySelector('.rw-page-chooser')?.remove();
  const chooser=document.createElement('div');chooser.className='rw-page-chooser';chooser.setAttribute('role','group');chooser.setAttribute('aria-label',action==='move'?'Move pages to position':'Copy pages to notebook');
  const title=document.createElement('strong');title.textContent=action==='move'?'Move to page position':'Copy to notebook';chooser.append(title);
  const cancel=()=>{chooser.remove();header.querySelector<HTMLButtonElement>('[aria-label="'+(action==='move'?'Move':'Copy to')+'"]')?.focus();};
  if(action==='move'){
   const input=document.createElement('input');input.type='number';input.min='1';input.max=String(data.pages.length);input.step='1';input.value=String(data.active+1);input.setAttribute('aria-label','Destination page position');
   chooser.append(input,button('Move','move',()=>{const at=Number(input.value);if(!Number.isInteger(at)||at<1||at>data.pages.length){fail(`Enter a page position from 1 to ${data.pages.length}.`);input.focus();return;}chooser.remove();void perform(action,input.value);}));
  } else {
   const destinations=adapter.destinations();
   for(const nb of destinations)chooser.append(button(nb.title,'copy',()=>{chooser.remove();void perform(action,nb.id);}));
   if(!destinations.length){const empty=document.createElement('p');empty.textContent='No other notebooks';chooser.append(empty);}
  }
  chooser.append(button('Cancel','close',cancel));panel.append(chooser);chooser.querySelector<HTMLElement>('input,button')?.focus();
 };
 function render(){
  if(closed)return;
  const focused=panel.contains(document.activeElement)?document.activeElement?.getAttribute('aria-label'):null;
  header.replaceChildren();const back=button('Back','back',()=>void finish());back.disabled=busy;
  const selectAll=button('Select all','check',()=>{selected=selected.size===data.pages.length?new Set():new Set(data.pages.map(p=>p.id));render();});selectAll.disabled=busy||loading||!data.pages.length;selectAll.setAttribute('aria-pressed',String(selected.size>0&&selected.size===data.pages.length));header.append(back,selectAll);
  const positions=data.pages.map((p,i)=>selected.has(p.id)?i:-1).filter(i=>i>=0);
  for(const [action,label,icon] of [['copy','Copy','copy'],['copyTo','Copy to','copy'],['left','Move left','prev'],['right','Move right','next'],['cover','Cover','cover'],['move','Move','move'],['delete','Delete','delete']] as const){
   const b=button(label,icon,()=>action==='copyTo'||action==='move'?choose(action):void perform(action));
   b.disabled=busy||loading||!selected.size||(action==='cover'&&selected.size!==1)||(action==='delete'&&selected.size===data.pages.length)||(action==='left'&&positions[0]===0)||(action==='right'&&positions[positions.length-1]===data.pages.length-1);header.append(b);
  }
  grid.replaceChildren();batch=Math.min(batch,Math.max(0,Math.ceil(data.pages.length/density)-1));
  data.pages.slice(batch*density,(batch+1)*density).forEach((page,i)=>{
   const index=batch*density+i,card=document.createElement('div');card.className='rw-page-card';
   const open=document.createElement('button');open.className='rw-page-preview';open.disabled=busy;open.setAttribute('aria-label',`Open page ${index+1}`);
   const caption=document.createElement('span');caption.className='rw-page-number';caption.textContent=String(index+1);
   const cover=document.createElement('span');cover.className='rw-page-cover';cover.textContent='Cover';cover.hidden=!page.cover;
   const paint=()=>{open.innerHTML=page.svg??'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 4"></svg>';open.append(caption,cover);};paint();
   if(!page.svg&&adapter.preview)void adapter.preview(page.id).then(svg=>{page.svg=svg;if(open.isConnected)paint();}).catch(fail);
   if(index===data.active){open.classList.add('current');open.setAttribute('aria-current','page');}
   bindPenButton(open,()=>void finish(index));
   const check=document.createElement('button');check.type='button';check.className='rw-page-select';check.disabled=busy;check.setAttribute('role','checkbox');check.setAttribute('aria-label',`Select page ${index+1}`);check.setAttribute('aria-checked',String(selected.has(page.id)));check.innerHTML=selected.has(page.id)?inkToolIcon('check'):'';
   bindPenButton(check,()=>{selected.has(page.id)?selected.delete(page.id):selected.add(page.id);render();});card.append(open,check);grid.append(card);
  });
  summary.textContent=loading?'Loading notebook pages…':`${data.pages.length} ${data.pages.length===1?'page':'pages'}${selected.size?' · '+selected.size+' selected':' · Tap a page to open it'}`;
  footer.replaceChildren();
  const batches=Math.max(1,Math.ceil(data.pages.length/density));
  const prev=button('Previous overview page','prev',()=>{batch--;render();}),next=button('Next overview page','next',()=>{batch++;render();});prev.disabled=batch===0||busy||loading;next.disabled=batch+1>=batches||busy||loading;
  const range=document.createElement('input');range.type='range';range.min='1';range.max=String(batches);range.value=String(batch+1);range.step='1';range.disabled=busy||loading||batches===1;range.setAttribute('aria-label','Overview page');range.onchange=()=>{batch=Number(range.value)-1;render();};
  const count=document.createElement('span');count.className='rw-page-count';count.textContent=`${batch+1}/${batches}`;
  const navigation=document.createElement('div');navigation.className='rw-page-overview-navigation';navigation.append(prev,range,next,count);
  const sizes=document.createElement('div');sizes.className='rw-page-density';
  for(const size of [4,9,16]){
   const cols=Math.sqrt(size),b=button(`Show ${size} pages`,'check',()=>{density=size;batch=0;try{localStorage.setItem('notes.pageOverviewDensity',String(size));}catch{/* optional */}render();});b.disabled=busy||loading;
   b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1">${Array.from({length:size},(_,i)=>`<rect x="${2+(i%cols)*20/cols}" y="${2+Math.floor(i/cols)*20/cols}" width="${20/cols-2}" height="${20/cols-2}"/>`).join('')}</svg>`;b.title=`Show ${size} pages`;b.setAttribute('aria-pressed',String(density===size));sizes.append(b);
  }
  grid.style.gridTemplateColumns=`repeat(${Math.sqrt(density)},minmax(0,1fr))`;grid.style.gridTemplateRows=`repeat(${Math.sqrt(density)},minmax(0,1fr))`;
  footer.append(navigation,sizes);
  if(focused){const next=[...panel.querySelectorAll<HTMLElement>('[aria-label]')].find(el=>el.getAttribute('aria-label')===focused&&!el.hasAttribute('disabled'));(next??panel).focus();}
 }
 async function refresh(){data=await adapter.load();if(closed)return;if(loading)batch=Math.floor(data.active/density);selected=new Set([...selected].filter(id=>data.pages.some(p=>p.id===id)));render();}
 panel.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();const chooser=panel.querySelector('.rw-page-chooser');if(chooser){chooser.remove();panel.focus();}else void finish();}
  if(event.key==='Tab'){const focusables=[...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')],first=focusables[0],last=focusables[focusables.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 });
 panel.append(header,summary,grid,status,footer);root.append(panel);render();panel.focus();
 void refresh().catch(fail).finally(()=>{loading=false;render();});
}
