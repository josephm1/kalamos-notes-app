import type {PageObject} from '../editor/pageObjects';
import {audioTime,type AudioStatus} from '../editor/pageAttachments';
import {bindPenButton,type PenButtonActivation} from './penButton';

/** Native playback owns sound; repainting or moving this small DOM card never restarts it. */
export function audioCard(object:PageObject,status:AudioStatus|undefined,activate:()=>void,activation:PenButtonActivation,nativeOwnsPen:()=>boolean):HTMLElement {
  const card=document.createElement('div');card.className='rw-audio-card';card.dataset.audioAttachment=object.attachment!.id;
  const play=document.createElement('button');play.type='button';play.className='rw-audio-play';
  play.addEventListener('pointerdown',event=>{event.stopPropagation();});
  bindPenButton(play,activate,true,activation,nativeOwnsPen);
  const details=document.createElement('div');details.className='rw-audio-details';
  const name=document.createElement('div');name.className='rw-audio-name';name.textContent=object.attachment!.name;name.title=object.attachment!.name;
  const time=document.createElement('div');time.className='rw-audio-time';
  details.append(name,time);card.append(play,details);
  updateAudioCard(card,status??{id:object.attachment!.id,playing:false,positionMs:0,durationMs:object.attachment!.durationMs??0});
  return card;
}
export function updateAudioCard(card:HTMLElement,status:AudioStatus):void {
  const button=card.querySelector<HTMLButtonElement>('.rw-audio-play')!;
  button.setAttribute('aria-label',status.playing?'Pause audio':'Play audio');
  button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${status.playing?'<path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="3"/>':'<path d="M7 4l13 8-13 8z" fill="currentColor"/>'}</svg>`;
  const time=card.querySelector<HTMLElement>('.rw-audio-time')!;
  time.textContent=`${audioTime(status.positionMs)} / ${status.durationMs>0?audioTime(status.durationMs):'--:--'}`;
}
