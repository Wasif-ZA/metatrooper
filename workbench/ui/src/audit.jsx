import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';

const PAGE = 50;

// The trail is read only when asked for; the core scrubs secrets from it.
export function Audit() {
  const pid = ui.projectId;
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(null); setMore(false); }, [pid]);
  const load = async (have) => {
    if (busy) return;
    setBusy(true);
    const last = have.length ? have[have.length - 1] : null;
    const r = await rpc('audit.list', { project_id: pid, limit: PAGE, ...(last ? { before: last.at, before_id: last.id } : {}) });
    setBusy(false);
    if (!r.result) return;
    setRows([...have, ...r.result.rows]);
    setMore(r.result.rows.length === PAGE);
  };
  return (
    <section>
      <h2>Audit trail</h2>
      {rows === null ? (
        <p className="ou-imeta"><Button size="sm" variant="secondary" label="Show the audit trail" isLoading={busy} onClick={() => void load([])} /></p>
      ) : rows.length ? (
        <ul className="ou-list">
          {rows.map((r) => (
            <li key={r.id} className="ou-irow" title={`${r.at}\n${r.detail}`}>
              <span className={r.source === 'agent' ? 'ou-dot ou-dot-work' : 'ou-dot'} /><span className="ou-ititle">{r.agent} · {r.action}</span><span className="ou-imeta">{r.detail}</span><span className="ou-itime">{ago(r.at)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="ou-imeta">Nothing recorded for this project yet.</p>}
      {rows !== null ? (
        <p className="ou-imeta">
          {more ? <Button size="sm" variant="ghost" label="Show older" isLoading={busy} onClick={() => void load(rows)} /> : null}
          <Button size="sm" variant="ghost" label="Refresh" onClick={() => void load([])} />
          <Button size="sm" variant="ghost" label="Hide" onClick={() => { setRows(null); setMore(false); }} />
        </p>
      ) : null}
    </section>
  );
}
