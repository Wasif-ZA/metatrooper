import { useEffect, useState } from 'react';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';

const count = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const cost = (r) => (r.usd === null || r.usd === undefined ? 'no price' : `${r.usd_estimated ? '~' : ''}$${r.usd.toFixed(2)}`);

export function Usage() {
  const [win, setWin] = useState('today');
  const [data, setData] = useState(null);
  useEffect(() => {
    if (typeof rpc !== 'function') return undefined;
    let live = true;
    const load = () => rpc('usage.summary', { window: win }, true).then((r) => { if (live && r.result) setData(r.result); });
    void load();
    const timer = setInterval(load, 60000);
    return () => { live = false; clearInterval(timer); };
  }, [win]);
  if (!data) return null;
  const name = (a) => {
    const x = ui.snap.sessions.find((y) => y.id === a.session_id);
    return x ? `${a.engine_id} ${taskOf(x)}` : `${a.engine_id} (closed or in another project)`;
  };
  return (
    <section>
      <h2>Usage</h2>
      <div className="ou-composerfoot">
        <SegmentedControl label="Usage window" size="sm" value={win} onChange={setWin}>
          <SegmentedControlItem value="today" label="Today" />
          <SegmentedControlItem value="week" label="7 days" />
        </SegmentedControl>
        <span className="ou-imeta">{count(data.total)} tokens · {cost(data)}</span>
      </div>
      {data.by_agent.length ? (
        <ul className="ou-list">
          {data.by_agent.slice(0, 8).map((a) => (
            <li key={`${a.session_id}:${a.engine_id}`} className="ou-irow">
              <span className="ou-dot" /><span className="ou-ititle">{name(a)}</span><span className="ou-imeta">{cost(a)}</span><span className="ou-itime">{count(a.tokens)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="ou-imeta">No tokens used in this window.</p>}
    </section>
  );
}
