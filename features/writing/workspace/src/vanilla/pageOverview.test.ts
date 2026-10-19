import {it,expect,vi,afterEach} from 'vitest';
import {showPageOverview} from './pageOverview';
afterEach(()=>{document.body.replaceChildren();localStorage.removeItem('notes.pageOverviewDensity');});
it('limits previews to four, exposes page navigation and submits stable selected IDs',async()=>{
 localStorage.removeItem('notes.pageOverviewDensity');
 const host=document.createElement('div');document.body.append(host);
 const mutate=vi.fn(async()=>{}),open=vi.fn(),close=vi.fn();
 showPageOverview(host,{load:async()=>({active:0,pages:Array.from({length:7},(_,i)=>({id:`p${i}`,svg:'<svg/>',cover:false}))}),mutate,open,close,destinations:()=>[]});
 await vi.waitFor(()=>expect(host.querySelectorAll('.rw-page-card')).toHaveLength(4));
 const click=(label:string)=>(host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
 expect(host.querySelector('[aria-label="Undo"]')).toBeNull();
 click('Show 9 pages');expect(host.querySelectorAll('.rw-page-card')).toHaveLength(7);
 click('Show 16 pages');expect(host.querySelectorAll('.rw-page-card')).toHaveLength(7);
 click('Show 4 pages');expect(host.querySelectorAll('.rw-page-card')).toHaveLength(4);
 click('Select page 2');click('Copy');await vi.waitFor(()=>expect(mutate).toHaveBeenCalledWith('copy',['p1'],undefined));
 await vi.waitFor(()=>expect((host.querySelector('[aria-label="Next overview page"]') as HTMLButtonElement).disabled).toBe(false));
 click('Next overview page');expect(host.querySelectorAll('.rw-page-card')).toHaveLength(3);click('Open page 7');expect(open).toHaveBeenCalledWith(6);host.remove();localStorage.removeItem('notes.pageOverviewDensity');
});


it('starts on the active batch, navigates by slider, and closes via Escape',async()=>{
 const host=document.createElement('div');document.body.append(host);const close=vi.fn();
 showPageOverview(host,{load:async()=>({active:5,pages:Array.from({length:10},(_,i)=>({id:`p${i}`,svg:'<svg/>',cover:i===0}))}),mutate:vi.fn(),open:vi.fn(),close,destinations:()=>[]});
 await vi.waitFor(()=>expect(host.querySelector('[aria-label="Open page 6"]')).not.toBeNull());
 const dialog=host.querySelector<HTMLElement>('[role=dialog]')!;expect(dialog.getAttribute('aria-modal')).toBe('true');
 const range=host.querySelector<HTMLInputElement>('[aria-label="Overview page"]')!;expect(range.value).toBe('2');range.value='3';range.dispatchEvent(new Event('change'));
 expect(host.querySelector('[aria-label="Open page 9"]')).not.toBeNull();dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await vi.waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(dialog.isConnected).toBe(false);
});
it('prevents deleting the only remaining page and distinguishes selection from opening',async()=>{
 const host=document.createElement('div');document.body.append(host);const open=vi.fn(),mutate=vi.fn();
 showPageOverview(host,{load:async()=>({active:0,pages:[{id:'only',svg:'<svg/>',cover:true}]}),mutate,open,close:vi.fn(),destinations:()=>[]});
 await vi.waitFor(()=>expect(host.querySelector('[aria-label="Select page 1"]')).not.toBeNull());
 (host.querySelector('[aria-label="Select page 1"]') as HTMLButtonElement).click();expect(open).not.toHaveBeenCalled();
 expect(host.querySelector('[aria-checked=true]')).not.toBeNull();expect((host.querySelector('[aria-label="Delete"]') as HTMLButtonElement).disabled).toBe(true);
 expect((host.querySelector('[aria-label="Cover"]') as HTMLButtonElement).disabled).toBe(false);
 (host.querySelector('[aria-label="Open page 1"]') as HTMLButtonElement).click();expect(open).toHaveBeenCalledWith(0);expect(mutate).not.toHaveBeenCalled();
});
it('keeps errors visible and locks all mutations and navigation until a mutation settles',async()=>{
 const host=document.createElement('div');document.body.append(host);let fail!:(e:Error)=>void;
 showPageOverview(host,{load:async()=>({active:0,pages:[{id:'first',svg:'<svg/>',cover:false},{id:'second',svg:'<svg/>',cover:false}]}),mutate:()=>new Promise((_,reject)=>{fail=reject;}),open:vi.fn(),close:vi.fn(),destinations:()=>[]});
 await vi.waitFor(()=>expect(host.querySelector('[aria-label="Select page 1"]')).not.toBeNull());
 (host.querySelector('[aria-label="Select page 1"]') as HTMLButtonElement).click();(host.querySelector('[aria-label="Copy"]') as HTMLButtonElement).click();
 for(const label of ['Back','Select all','Copy','Delete','Show 9 pages'])expect((host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).disabled).toBe(true);
 fail(Error('Cannot save copied page'));await vi.waitFor(()=>expect(host.querySelector('[role=alert]')?.textContent).toContain('Cannot save copied page'));
 expect(host.querySelector('[role=dialog]')).not.toBeNull();expect((host.querySelector('[aria-label="Back"]') as HTMLButtonElement).disabled).toBe(false);
});
it('validates move positions and dismisses the chooser before the overview on Escape',async()=>{
 const host=document.createElement('div');document.body.append(host);const close=vi.fn(),mutate=vi.fn();
 showPageOverview(host,{load:async()=>({active:0,pages:[{id:'first',svg:'<svg/>',cover:false},{id:'second',svg:'<svg/>',cover:false}]}),mutate,open:vi.fn(),close,destinations:()=>[]});
 await vi.waitFor(()=>expect(host.querySelector('[aria-label="Select page 1"]')).not.toBeNull());
 (host.querySelector('[aria-label="Select page 1"]') as HTMLButtonElement).click();(host.querySelector('[aria-label="Move"]') as HTMLButtonElement).click();
 const input=host.querySelector<HTMLInputElement>('input[type=number]')!;input.value='1.5';(host.querySelector('.rw-page-chooser [aria-label="Move"]') as HTMLButtonElement).click();expect(mutate).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')).not.toBeNull();
 input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(host.querySelector('.rw-page-chooser')).toBeNull();expect(close).not.toHaveBeenCalled();
});
