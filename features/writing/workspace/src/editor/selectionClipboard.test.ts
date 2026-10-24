import {afterEach,expect,it,vi} from 'vitest';
import {clearSelectionClipboard,readSelectionClipboard,writeSelectionClipboard} from './selectionClipboard';
afterEach(()=>{vi.restoreAllMocks();clearSelectionClipboard();});
it('retains a verified copy through process recreation and isolates mutable callers',async()=>{
 const value={bounds:{x:1,y:2,width:30,height:44},textBoxes:[{id:'text',blockId:'b0',text:'private selection',x:1,y:2,width:30,size:19}]};
 writeSelectionClipboard(value);value.textBoxes[0].text='mutated source';
 expect(readSelectionClipboard()!.textBoxes[0].text).toBe('private selection');
 vi.resetModules();const reopened=await import('./selectionClipboard');
 const pasted=reopened.readSelectionClipboard()!;expect(pasted.textBoxes[0].text).toBe('private selection');
 pasted.textBoxes[0].text='mutated destination';expect(reopened.readSelectionClipboard()!.textBoxes[0].text).toBe('private selection');
 reopened.clearSelectionClipboard();
});
it('rejects a failed durable write instead of claiming the cut payload is safe',()=>{
 vi.spyOn(Object.getPrototypeOf(localStorage),'setItem').mockImplementation(()=>{throw new Error('quota');});
 expect(()=>writeSelectionClipboard({bounds:{x:0,y:0,width:1,height:1},textBoxes:[]})).toThrow('quota');
 expect(readSelectionClipboard()).toBeNull();
});
