import { createEmptySidecar } from '../sidecar/schema';
import { fingerprintOf } from '../documents/fingerprint';

export const NOTEBOOK_TEMPLATES = [
  { id: 'ruled', name: 'Ruled', category: 'Personal' },
  { id: 'week', name: 'Week', category: 'Personal' },
  { id: 'tasks', name: 'Tasks', category: 'Work' },
  { id: 'meeting', name: 'Meeting', category: 'Work' },
  { id: 'journal', name: 'Journal', category: 'Personal' },
  { id: 'cornell', name: 'Cornell', category: 'Study' },
  { id: 'mckinsey', name: 'McKinsey', category: 'Work' },
  { id: 'project', name: 'Project', category: 'Work' },
  { id: 'daily', name: 'Daily log', category: 'Personal' },
  { id: 'revision', name: 'Revision', category: 'Study' },
  { id: 'outline', name: 'Outline', category: 'Study' },
] as const;
export type NotebookTemplateId = typeof NOTEBOOK_TEMPLATES[number]['id'];

/** Template content is ordinary ruled text, not a background bitmap. Saved
 * word coordinates participate in spacing, Undo and export just like typing.
 * Checkboxes use the same anchors; shapes deliberately do not. */
export function createNotebookTemplate(id: string, title: string, width: number, lineHeight: number, screenHeight = 800) {
  const source = '\u200b';
  const sidecar = createEmptySidecar(title, fingerprintOf(source).hash);
  const h = Math.max(24, Math.min(120, lineHeight));
  const w = Math.max(240, width);
  sidecar.layoutLineHeight = h;
  sidecar.textBoxes = [];
  let sequence = 0;
  const label = (text: string, row: number, checkbox = false) => {
    const x = checkbox ? w-52 : 16;
    sidecar.textBoxes!.push({ id: `template-${++sequence}`, blockId: 'planning-document', text,
      x, y: row*h, width: checkbox ? 36 : w-80, size: Math.round(h*.58), autoWidth: true, checkbox });
  };
  if (id === 'week') ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].forEach((day, i) => label(day,i*2));
  if (id === 'tasks') { label('Priorities',0); for (let row=2;row<14;row++) label('☐',row,true); }
  if (id === 'meeting') { label('Agenda',0); label('Notes',4); label('Actions',10); for (let row=11;row<16;row++) label('☐',row,true); }
  if (id === 'journal') { label('Today',0); label('Grateful for',4); label('Reflection',8); label('Tomorrow',14); }
  // New starters use ordinary row-anchored text/check controls. No bitmap or separate editor:
  // inserting/removing rows moves these fields with the handwriting and survives save/export.
  const rows = Math.max(8, Math.floor((screenHeight-32)/h));
  const section = (text: string, fraction: number) => label(text, Math.floor((rows-2)*fraction));
  if (id === 'cornell') {
    label('Cues',0); sidecar.textBoxes![0].width = Math.round((w-24)*.28)-20;
    label('Notes',0); sidecar.textBoxes![1].x = Math.round((w-24)*.32);
    sidecar.textBoxes![1].width = w-80-sidecar.textBoxes![1].x;
    section('Summary',.85);
    // The column divider is a normal editable vector, not ink/text. It can be moved/resized
    // independently; the actual written content continues to participate in ruled spacing.
    sidecar.pageObjects = [{id:'cornell-divider',blockId:'planning-document',kind:'line',
      x:Math.round((w-24)*.29),y:h,width:1,height:Math.max(h,(Math.floor((rows-2)*.85)-1)*h),
      color:'#000000',strokeWidth:1,points:[{x:0,y:0},{x:0,y:100}]}];
  }
  if (id === 'mckinsey') { section('Problem',0); section('Issues',.25); section('Evidence',.5); section('Next steps',.75); }
  if (id === 'project') { section('Goal',0); section('Milestones',.3); section('Next actions',.65); for(let row=Math.floor((rows-2)*.65)+1;row<rows-1;row++)label('☐',row,true); }
  if (id === 'daily') { section('Today',0); section('Tasks',.2); for(let row=Math.floor((rows-2)*.2)+1;row<Math.floor((rows-2)*.6);row++)label('☐',row,true); section('Notes',.6); }
  if (id === 'revision') { section('Topic',0); section('Key ideas',.2); section('Questions',.6); }
  if (id === 'outline') { section('Topic',0); section('1.',.2); section('2.',.45); section('3.',.7); }
  return { source, sidecar, template: NOTEBOOK_TEMPLATES.find(t => t.id === id)?.id ?? 'ruled' };
}
