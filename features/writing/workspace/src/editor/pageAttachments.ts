import type { PageObject } from './pageObjects';

/** Stable references to immutable files in the host's attachment store, never device paths. */
export type Attachment = { id: string; name: string; mime: string; width?: number; height?: number; durationMs?: number };
export type AudioStatus = { id:string; playing:boolean; positionMs:number; durationMs:number };

export function audioTime(ms:number):string {
  const seconds=Math.max(0,Math.floor(Number.isFinite(ms)?ms/1000:0));
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

export type PageAttachment = { kind: 'image' | 'audio' | 'file'; attachment: Attachment } |
  { kind: 'link'; link: { url: string; title: string } };

export function webLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function validAttachment(value: unknown): value is Attachment {
  if (!value || typeof value !== 'object') return false;
  const a = value as Attachment;
  return typeof a.id === 'string' && /^[a-f0-9]{64}$/.test(a.id) &&
    typeof a.name === 'string' && a.name.length > 0 && a.name.length <= 240 &&
    typeof a.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(a.mime) &&
    [a.width, a.height].every(n => n === undefined || typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100000) &&
    (a.durationMs === undefined || Number.isFinite(a.durationMs) && a.durationMs >= 0);
}

export function isAttachmentObject(object: PageObject): boolean {
  return ['image', 'audio', 'file', 'link'].includes(object.kind);
}

export function validPageAttachment(object: PageObject): boolean {
  if (object.kind === 'link') return !!object.link && typeof object.link.title === 'string' &&
    object.link.title.length <= 240 && typeof object.link.url === 'string' &&
    object.link.url.length <= 4096 && webLink(object.link.url) !== null;
  if (!['image', 'audio', 'file'].includes(object.kind)) return true;
  return validAttachment(object.attachment) &&
    (object.kind !== 'image' || ['image/png', 'image/jpeg', 'image/webp'].includes(object.attachment.mime)) &&
    (object.kind !== 'audio' || object.attachment.mime.startsWith('audio/'));
}

export function attachmentLabel(object: PageObject): string {
  return object.link?.title || object.link?.url || object.attachment?.name || 'Attachment';
}

/** Decode once per workspace, outside the writing path. Export waits for actual image readiness. */
export class AttachmentImages {
  private images = new Map<string, { source: string; image: HTMLImageElement }>();
  private pending = new Map<string, Promise<void>>();
  private disposed = false;
  constructor(private load?: (attachment: Attachment) => Promise<string>, private changed?: () => void) {}
  source(object: PageObject): string | undefined { return this.images.get(object.attachment?.id ?? '')?.source; }
  image(object: PageObject): HTMLImageElement | undefined { return this.images.get(object.attachment?.id ?? '')?.image; }
  async ready(objects: PageObject[]): Promise<void> {
    await Promise.all(objects.filter(o => o.kind === 'image' && o.attachment).map(o => this.ensure(o.attachment!)));
  }
  private ensure(attachment: Attachment): Promise<void> {
    if (this.images.has(attachment.id)) return Promise.resolve();
    const existing = this.pending.get(attachment.id);
    if (existing) return existing;
    if (!this.load) return Promise.reject(new Error('Image attachments are unavailable in this host.'));
    const task = (async () => {
      const source = await this.load!(attachment);
      if (source.length > 12_000_000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source))
        throw new Error('The attached image could not be read.');
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The attached image did not finish loading.')), 15000);
        image.onload = () => { clearTimeout(timer); resolve(); };
        image.onerror = () => { clearTimeout(timer); reject(new Error('The attached image could not be decoded.')); };
        image.src = source;
      });
      if (!this.disposed) { this.images.set(attachment.id, { source, image }); this.changed?.(); }
    })();
    this.pending.set(attachment.id, task);
    void task.catch(() => {}).finally(() => this.pending.delete(attachment.id));
    return task;
  }
  dispose() { this.disposed = true; this.images.clear(); this.pending.clear(); }
}

export function attachmentSvg(object: PageObject, imageSource?: string): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
  if (object.kind === 'image' && imageSource && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageSource))
    return `<svg x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" viewBox="0 0 ${object.width} ${object.height}"><rect width="${object.width}" height="${object.height}" fill="#fff"/><image href="${imageSource}" width="${object.width}" height="${object.height}" preserveAspectRatio="none"/></svg>`;
  if (object.kind === 'audio') {
    const time = `0:00 / ${object.attachment?.durationMs ? audioTime(object.attachment.durationMs) : '--:--'}`;
    return `<svg x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" viewBox="0 0 ${object.width} ${object.height}"><rect x="1" y="1" rx="4" width="${object.width-2}" height="${object.height-2}" fill="#fff" stroke="#000"/><path d="M16 ${object.height/2-8}l12 8-12 8z" fill="#000"/><text x="44" y="20" font-family="sans-serif" font-size="14" fill="#000">${escape(attachmentLabel(object))}</text><text x="44" y="38" font-family="sans-serif" font-size="12" fill="#000">${time}</text></svg>`;
  }
  const type = object.kind === 'link' ? 'Link · Open' : object.kind === 'image' ? 'Image · Loading or unavailable' : 'File · Open';
  return `<svg x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}" viewBox="0 0 ${object.width} ${object.height}"><rect x="1" y="1" width="${Math.max(1, object.width - 2)}" height="${Math.max(1, object.height - 2)}" fill="#fff" stroke="#000"/><text x="12" y="24" font-family="sans-serif" font-size="16" fill="#000">${escape(type)}</text><text x="12" y="48" font-family="sans-serif" font-size="16" fill="#000">${escape(attachmentLabel(object))}</text></svg>`;
}

export function drawAttachment(ctx: CanvasRenderingContext2D, object: PageObject, image?: HTMLImageElement) {
  if (object.kind === 'image' && image) {
    ctx.fillStyle='#fff';ctx.fillRect(object.x,object.y,object.width,object.height);
    ctx.drawImage(image, object.x, object.y, object.width, object.height); return;
  }
  ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(object.x, object.y, object.width, object.height);
  ctx.strokeStyle = '#000'; ctx.strokeRect(object.x, object.y, object.width, object.height);
  ctx.beginPath(); ctx.rect(object.x, object.y, object.width, object.height); ctx.clip();
  ctx.fillStyle = '#000'; ctx.font = '16px sans-serif'; ctx.textBaseline = 'top';
  if (object.kind === 'audio') {
    ctx.beginPath(); ctx.moveTo(object.x+16,object.y+object.height/2-8);ctx.lineTo(object.x+28,object.y+object.height/2);ctx.lineTo(object.x+16,object.y+object.height/2+8);ctx.closePath();ctx.fill();
    ctx.font='14px sans-serif';ctx.fillText(attachmentLabel(object),object.x+44,object.y+6);
    ctx.font='12px sans-serif';ctx.fillText(`0:00 / ${object.attachment?.durationMs ? audioTime(object.attachment.durationMs) : '--:--'}`,object.x+44,object.y+26);ctx.restore();return;
  }
  ctx.fillText(object.kind === 'link' ? 'Link' : object.kind === 'image' ? 'Image unavailable' : 'File', object.x + 12, object.y + 8);
  ctx.fillText(attachmentLabel(object), object.x + 12, object.y + 32); ctx.restore();
}
