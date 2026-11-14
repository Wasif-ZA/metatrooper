export const chatModeOf = (engineId, source) => source === 'transcript' ? 'chat' : 'terminal';

export const TERMINAL_ONLY_NOTE = 'This agent shares no chat record, so cc shows its terminal only.';

export const approvalInput = (engineId, allow) => engineId === 'claude' ? allow ? '1' : '\x1b' : null;

export function approvalText(item) {
  return item.label.replace(/^(Ran|Edited|Used) /, (_, verb) => ({ Ran: '', Edited: 'Edit ', Used: 'Use ' })[verb]);
}

export function groupItems(items) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length < 2) out.push(...run);
    else {
      const failed = run.filter((x) => x.status === 'error').length;
      const suffix = failed ? ` · ${failed} failed` : run.some((x) => x.status === 'running') ? ' · working' : '';
      out.push({ kind: 'steps', id: `steps:${run[0].id}`, items: run, label: `${run.length} steps${suffix}` });
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === 'tool' && !item.file && item.status !== 'waiting') run.push(item);
    else { flush(); out.push(item); }
  }
  flush();
  return out;
}
