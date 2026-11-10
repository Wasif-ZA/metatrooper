import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';

const seen = new Map();
const WORDS = { done: 'Done, check passed', checks_passed: 'Check passed', needs_review: 'Needs your review' };
const settled = (x) => x.state === 'done' || x.state === 'idle';

// done.result runs git, so it is asked once per session state change
export function Verdict({ x }) {
  const key = `${x.id}:${x.state_at}`;
  const [v, setV] = useState(seen.get(key) || null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setV(seen.get(key) || null);
    if (!settled(x) || seen.has(key) || typeof rpc !== 'function') return undefined;
    let live = true;
    void rpc('done.result', { session_id: x.id }, true).then((r) => {
      if (!r.result) return;
      seen.set(key, r.result);
      if (live) setV(r.result);
    });
    return () => { live = false; };
  }, [key]);
  if (!v || !settled(x) || (x.state === 'idle' && !v.proof)) return null;
  const why = v.proof ? `${v.proof.command} exited with ${v.proof.exit_code}` : 'No check has run on these files as they are now.';
  const run = async (e) => {
    e?.stopPropagation?.();
    setBusy(true);
    const r = await api.runCheck(x.id);
    setBusy(false);
    if (!r || r.error) { toast((r && r.error) || 'The check did not run.', true); return; }
    toast(r.exit_code === 0 ? 'Check passed.' : `Check failed (exit ${r.exit_code}).`, r.exit_code !== 0);
    const next = await rpc('done.result', { session_id: x.id }, true);
    if (next.result) { seen.set(key, next.result); setV(next.result); }
  };
  return (
    <span title={why}>
      <Badge label={WORDS[v.result] || v.result} />
      {v.result === 'needs_review' ? <Button size="sm" variant="ghost" label={busy ? 'Checking' : 'Run check'} isDisabled={busy} data-action="run-check" onClick={run} /> : null}
    </span>
  );
}
