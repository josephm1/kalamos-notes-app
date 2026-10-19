import { PenWorkspace, type PenWorkspaceProps } from '../src/vanilla/penWorkspace';
import { parseMarkdown } from '../src/markdown/parse';
import { DEFAULT_PREFERENCES } from '../src/storage/preferences';
import type { TranscriptionSheet } from '../src/editor/inkTranscription';

/** Actual editor view for local element QA; no Android or vendor surface is simulated. */
export function openHostPage(sheet: TranscriptionSheet, onCommit?: (payload: import('../editor/PenWorkspace').CommitPayload)=>void, actions?:PenWorkspaceProps['documentActions']) {
  const host = document.createElement('div');
  host.style.cssText = 'width:100%;height:100vh';
  const theme = document.createElement('div');
  theme.className = 'vanilla-app';
  theme.style.cssText = 'width:100%;height:100vh';
  theme.append(host);
  document.body.append(theme);
  return new PenWorkspace(host, {
    documentActions:actions,
    block: parseMarkdown(sheet.source)[0],
    existingRuns: sheet.sidecar.inkRuns,
    existingTextBoxes: sheet.sidecar.textBoxes,
    existingSourceWords: sheet.sidecar.sourceWords,
    existingPageObjects: sheet.sidecar.pageObjects,
    existingLineHeight: sheet.sidecar.layoutLineHeight,
    prefs: DEFAULT_PREFERENCES,
    eink: true,
    native: false,
    onCommit(payload) { onCommit?.(payload); },
    onCancel() {},
  });
}
