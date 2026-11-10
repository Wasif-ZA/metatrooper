import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';

const seen = new Map();
const WORDS = { done: 'Done, check passed', checks_passed: 'Check passed', needs_review: 'Needs your review' };
const settled = (x) => x.state === 'done' || x.state === 'idle';

// done.result runs git, so it is asked once per session state change
export function Verdict({ x }) {
  const key = `${x.id}:${x.state_at}`;
  const [v, setV] = useState(seen.get(key) || null);
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
  return <span title={why}><Badge label={WORDS[v.result] || v.result} /></span>;
}
