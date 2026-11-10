import { useState, useEffect } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { createStore } from './store.js';
import { Verdict } from './verdict.jsx';
import { Usage } from './usage.jsx';
import { Audit } from './audit.jsx';
import { AgentHead } from './agenthead.jsx';

export const homeStore = createStore({ tick: 0 });
export const newTaskStore = createStore({ open: false });
export const openNewTask = () => newTaskStore.set({ open: true });

const svg = (d) => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const ICONS = {
  needs: 'M1.5 8.5l2-5.5h9l2 5.5v4.5h-13zM1.5 8.5h4l1 1.5h3l1-1.5h4',
  working: 'M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M3.8 3.8l1.7 1.7M10.5 10.5l1.7 1.7M3.8 12.2l1.7-1.7M10.5 5.5l1.7-1.7',
  done: 'M3 8.5l3.2 3.2L13 4.8',
  files: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
  dollar: 'M8 2v12M11 4.5H6.5a2 2 0 000 4h3a2 2 0 010 4H5',
  shield: 'M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4z',
};

function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`.replace('.0M', 'M');
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`.replace('.0k', 'k');
  return String(v);
}

function formatDay(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return String(iso);
}

function outcomeWord(state) {
  if (state === 'done') return 'finished';
  if (state === 'working' || state === 'starting') return 'running';
  if (state === 'waiting_for_you') return 'waiting';
  return state;
}

function outcomeColor(state) {
  if (state === 'done') return 'green';
  if (state === 'working' || state === 'starting') return 'blue';
  if (state === 'waiting_for_you') return 'amber';
  return 'mute';
}

function UsageWarn({ engine, pct }) {
  if (pct == null || pct < 80) return null;
  return (
    <div className="ou-dash-usagewarn">
      {`${engine} has used ${pct}% of its window.`}
    </div>
  );
}

// The start box is the centred composer of OpenHands' home: text first, agent picker and Start in its footer.
function StartBox({ ready }) {
  const [task, setTask] = useState(ui.drafts['home-task'] || '');
  const [engine, setEngine] = useState(ui.drafts['home-engine'] || load('engine') || ready[0].id);
  const chosen = ready.some((e) => e.id === engine) ? engine : ready[0].id;
  const [more, setMore] = useState(false);
  const [branch, setBranch] = useState('');
  const [model, setModel] = useState('');
  const [approval, setApproval] = useState('default');
  const start = async () => {
    const text = task.trim();
    let target = ui.projectId;
    if (branch.trim()) {
      const wt = await rpc('worktree.create', { project_id: ui.projectId, branch: branch.trim() });
      if (!wt.result) return;
      const opened = await rpc('project.open', { path: wt.result.path });
      if (!opened.result) return;
      target = opened.result.project_id;
    }
    const r = await rpc('session.launch', { project_id: target, engine_id: chosen, ...(text ? { prompt: text } : {}), ...(model.trim() ? { model: model.trim() } : {}), ...(approval !== 'default' ? { approval } : {}) });
    if (!r.result) return;
    delete ui.drafts['home-task'];
    setTask('');
    save('engine', chosen);
    homeView.set('wall');
    setBranch('');
    newTaskStore.set({ open: false });
    if (target !== ui.projectId) { ui.pendingPick = r.result.session_id; switchProject(target); return; }
    await pick(r.result.session_id);
  };
  return (
    <div className="ou-composer" onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void start(); } }}>
      <TextArea label="Task for a new agent" isLabelHidden rows={1} value={task} placeholder="What should an agent do? Leave it empty to just open one." onChange={(v) => { ui.drafts['home-task'] = v; setTask(v); }} />
      <div className="ou-composerfoot">
        <Selector label="Agent" isLabelHidden size="sm" variant="ghost" options={ready.map((e) => ({ value: e.id, label: e.id }))} value={chosen} onChange={(v) => { ui.drafts['home-engine'] = v; setEngine(v); }} />
        <Button variant="ghost" size="sm" label={more ? 'Fewer options' : 'Options'} aria-expanded={more} onClick={() => setMore(!more)} />
        <Button variant="primary" size="sm" label="Start" tooltip="Start (Ctrl+Enter)" data-action="home-start" data-engine={chosen} onClick={start} />
      </div>
      {more ? (
        <div className="ou-composerfoot">
          <TextInput size="sm" width={240} label="Branch for a new worktree" isLabelHidden placeholder="Branch (agent gets its own worktree)" value={branch} onChange={setBranch} />
          <TextInput size="sm" width={180} label="Model" isLabelHidden placeholder="Model (agent default)" value={model} onChange={setModel} />
          <Selector label="Approval" isLabelHidden size="sm" variant="ghost" value={approval} onChange={setApproval} options={[
            { value: 'default', label: 'Approval: as in Settings' },
            { value: 'ask', label: 'Approval: ask before each tool call' },
            { value: 'edits', label: 'Approval: file edits allowed' },
            { value: 'contained', label: 'Approval: auto' },
          ]} />
        </div>
      ) : null}
    </div>
  );
}

export function NewTask() {
  const { open } = newTaskStore.use();
  const ready = (ui.snap?.engines || []).filter((e) => e.light !== 'red');
  return (
    <Dialog isOpen={Boolean(open)} onOpenChange={(o) => newTaskStore.set({ open: Boolean(o) })} aria-label="New task" width={560}>
      <DialogHeader title="New task" onOpenChange={(o) => newTaskStore.set({ open: Boolean(o) })} />
      <div style={{ padding: '0 16px 16px' }}>
        {ready.length ? <StartBox ready={ready} /> : <EmptyState title="No agent is ready. Check Add-ons." isCompact />}
      </div>
    </Dialog>
  );
}

// Agent cards follow Paperclip's live cards: identity row, the task, then what the agent last said in mono, with a quiet footer.
function AgentCard({ x }) {
  const files = changedFiles(x.id).length;
  return (
    <div className="ou-agent" data-action="pick" data-id={x.id} role="button" tabIndex={0}>
      <AgentHead x={x} />
      {x.run_id ? (
        <div className="ou-dash-lastrun">
          <span className="ou-dash-chip">{x.run_id.slice(0, 8)}</span>
          <span className={`ou-dash-outcome ou-dash-${outcomeColor(x.state)}`}>{outcomeWord(x.state)}</span>
          <span className="ou-dash-runat">{ago(x.state_at)}</span>
        </div>
      ) : null}
      <pre>{x.last_line || ' '}</pre>
      <footer><span>{files ? `${files} changed ${files === 1 ? 'file' : 'files'}` : 'No changes yet'}</span><Verdict x={x} />{x.state === 'waiting_for_you' ? <Button size="sm" label="Answer" data-action="pick" data-id={x.id} /> : null}</footer>
    </div>
  );
}

function DashTile({ icon, label, value, sub, hot }) {
  return (
    <div className={hot ? 'ou-dash-tile ou-tile ou-hot' : 'ou-dash-tile ou-tile'}>
      <span className="ou-dash-tileicon ou-tileicon">{svg(ICONS[icon])}</span>
      <b>{value}</b>
      <span className="ou-dash-tilelabel ou-tilelabel">{label}</span>
      <span className="ou-dash-tilesub ou-tilesub">{sub}</span>
    </div>
  );
}

function ChartBox({ title, sub, children }) {
  return (
    <div className="ou-dash-chart-box">
      <div className="ou-dash-chart-head">
        <span className="ou-dash-chart-title">{title}</span>
        <span className="ou-dash-chart-sub">{sub}</span>
      </div>
      <div className="ou-dash-chart-body">
        {children}
      </div>
    </div>
  );
}

function ChartDates({ days }) {
  if (!days || !days.length) return null;
  const first = days[0]?.day;
  const mid = days[Math.floor(days.length / 2)]?.day;
  const last = days[days.length - 1]?.day;
  return (
    <div className="ou-dash-chart-dates">
      <span>{formatDay(first)}</span>
      <span>{formatDay(mid)}</span>
      <span>{formatDay(last)}</span>
    </div>
  );
}

function ChartRuns({ data, loading, error }) {
  if (loading) return <ChartBox title="Runs by outcome" sub="Last 14 days"><span className="ou-dash-muted">Loading.</span></ChartBox>;
  if (error || !data || !data.days) return <ChartBox title="Runs by outcome" sub="Last 14 days"><span className="ou-dash-muted">No data yet.</span></ChartBox>;
  const days = data.days;
  const max = Math.max(1, ...days.map((d) => (d.succeeded || 0) + (d.failed || 0) + (d.unchecked || 0)));
  return (
    <ChartBox title="Runs by outcome" sub="Last 14 days">
      <div className="ou-dash-chart-bars">
        {days.map((d, i) => {
          const s = d.succeeded || 0;
          const f = d.failed || 0;
          const u = d.unchecked || 0;
          const total = s + f + u;
          const heightPct = Math.round((total / max) * 100);
          if (total === 0) {
            return (
              <div key={d.day || i} className="ou-dash-chart-col">
                <div className="ou-dash-bar-tick" />
              </div>
            );
          }
          const uPct = (u / total) * 100;
          const fPct = (f / total) * 100;
          const sPct = (s / total) * 100;
          return (
            <div key={d.day || i} className="ou-dash-chart-col">
              <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="ou-dash-bar-svg" style={{ height: `${heightPct}%` }}>
                {u > 0 ? <rect x="0" y="0" width="10" height={uPct} fill="var(--mute)" /> : null}
                {f > 0 ? <rect x="0" y={uPct} width="10" height={fPct} fill="var(--del)" /> : null}
                {s > 0 ? <rect x="0" y={uPct + fPct} width="10" height={sPct} fill="var(--green)" /> : null}
              </svg>
            </div>
          );
        })}
      </div>
      <ChartDates days={days} />
      <div className="ou-dash-legend">
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--green)' }} />Succeeded</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--del)' }} />Failed</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--mute)' }} />Unchecked</span>
      </div>
    </ChartBox>
  );
}

const ENGINE_COLORS = ['var(--blue)', 'var(--amber)', 'var(--green)', 'var(--accent)'];

function ChartTokens({ data, loading, error }) {
  if (loading) return <ChartBox title="Tokens and cost by engine" sub="This week"><span className="ou-dash-muted">Loading.</span></ChartBox>;
  if (error || !data) return <ChartBox title="Tokens and cost by engine" sub="This week"><span className="ou-dash-muted">No data yet.</span></ChartBox>;
  const raw = data.by_agent || [];
  const map = new Map();
  for (const r of raw) {
    const cur = map.get(r.engine_id) || { engine_id: r.engine_id, tokens: 0, usd: 0 };
    cur.tokens += Number(r.tokens) || 0;
    cur.usd += Number(r.usd) || 0;
    map.set(r.engine_id, cur);
  }
  const engines = Array.from(map.values());
  if (!engines.length) return <ChartBox title="Tokens and cost by engine" sub="This week"><span className="ou-dash-muted">No data yet.</span></ChartBox>;
  const max = Math.max(1, ...engines.map((e) => e.tokens));
  return (
    <ChartBox title="Tokens and cost by engine" sub="This week">
      <div className="ou-dash-chart-bars" style={{ height: '110px' }}>
        {engines.map((e, idx) => {
          const heightPct = e.tokens > 0 ? Math.max(4, Math.round((e.tokens / max) * 100)) : 0;
          const color = ENGINE_COLORS[idx % ENGINE_COLORS.length];
          return (
            <div key={e.engine_id} className="ou-dash-chart-col" style={{ alignItems: 'center' }}>
              <div className="ou-dash-engine-val">
                <span>{formatTokens(e.tokens)}</span>
                <span>${(e.usd || 0).toFixed(2)}</span>
              </div>
              <div style={{ width: '100%', height: '56px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                {e.tokens === 0 ? (
                  <div className="ou-dash-bar-tick" />
                ) : (
                  <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="ou-dash-bar-svg" style={{ height: `${heightPct}%` }}>
                    <rect x="0" y="0" width="10" height="100" fill={color} />
                  </svg>
                )}
              </div>
              <span className="ou-dash-engine-label" title={e.engine_id}>{e.engine_id}</span>
            </div>
          );
        })}
      </div>
    </ChartBox>
  );
}

function ChartSessions({ data, loading, error }) {
  if (loading) return <ChartBox title="Sessions by state" sub="Last 14 days"><span className="ou-dash-muted">Loading.</span></ChartBox>;
  if (error || !data || !data.days) return <ChartBox title="Sessions by state" sub="Last 14 days"><span className="ou-dash-muted">No data yet.</span></ChartBox>;
  const days = data.days;
  const parsed = days.map((d) => {
    const st = d.started || {};
    const w = st.working || 0;
    const wait = st.waiting_for_you || 0;
    const done = st.done || 0;
    const other = Object.entries(st).reduce((n, [k, v]) => (['working', 'waiting_for_you', 'done'].includes(k) ? n : n + (v || 0)), 0);
    const total = w + wait + done + other;
    return { day: d.day, w, wait, done, other, total };
  });
  const max = Math.max(1, ...parsed.map((p) => p.total));
  return (
    <ChartBox title="Sessions by state" sub="Last 14 days">
      <div className="ou-dash-chart-bars">
        {parsed.map((p, i) => {
          const heightPct = Math.round((p.total / max) * 100);
          if (p.total === 0) {
            return (
              <div key={p.day || i} className="ou-dash-chart-col">
                <div className="ou-dash-bar-tick" />
              </div>
            );
          }
          const otherPct = (p.other / p.total) * 100;
          const donePct = (p.done / p.total) * 100;
          const waitPct = (p.wait / p.total) * 100;
          const wPct = (p.w / p.total) * 100;
          return (
            <div key={p.day || i} className="ou-dash-chart-col">
              <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="ou-dash-bar-svg" style={{ height: `${heightPct}%` }}>
                {p.other > 0 ? <rect x="0" y="0" width="10" height={otherPct} fill="var(--mute)" /> : null}
                {p.done > 0 ? <rect x="0" y={otherPct} width="10" height={donePct} fill="var(--green)" /> : null}
                {p.wait > 0 ? <rect x="0" y={otherPct + donePct} width="10" height={waitPct} fill="var(--wait)" /> : null}
                {p.w > 0 ? <rect x="0" y={otherPct + donePct + waitPct} width="10" height={wPct} fill="var(--blue)" /> : null}
              </svg>
            </div>
          );
        })}
      </div>
      <ChartDates days={days} />
      <div className="ou-dash-legend">
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--blue)' }} />Working</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--wait)' }} />Waiting</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--green)' }} />Done</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--mute)' }} />Other</span>
      </div>
    </ChartBox>
  );
}

function ChartChecks({ data, loading, error }) {
  if (loading) return <ChartBox title="Done-check pass rate" sub="Last 14 days"><span className="ou-dash-muted">Loading.</span></ChartBox>;
  if (error || !data || !data.days) return <ChartBox title="Done-check pass rate" sub="Last 14 days"><span className="ou-dash-muted">No data yet.</span></ChartBox>;
  const days = data.days;
  const totalPassed = days.reduce((n, d) => n + (d.passed || 0), 0);
  const totalRuns = days.reduce((n, d) => n + (d.runs || 0), 0);
  return (
    <ChartBox title="Done-check pass rate" sub="Last 14 days">
      <div className="ou-dash-chart-bars">
        {days.map((d, i) => {
          if (d.rate == null || !d.runs) {
            return (
              <div key={d.day || i} className="ou-dash-chart-col">
                <div className="ou-dash-bar-tick" />
              </div>
            );
          }
          const heightPct = Math.max(2, Math.round(d.rate * 100));
          return (
            <div key={d.day || i} className="ou-dash-chart-col">
              <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="ou-dash-bar-svg" style={{ height: `${heightPct}%` }}>
                <rect x="0" y="0" width="10" height="100" fill="var(--green)" />
              </svg>
            </div>
          );
        })}
      </div>
      <ChartDates days={days} />
      <div className="ou-dash-legend">
        <span className="ou-dash-legend-item">
          <span className="ou-dash-legend-sq" style={{ background: 'var(--green)' }} />
          {`${totalPassed} of ${totalRuns} passed`}
        </span>
      </div>
    </ChartBox>
  );
}

export function Home() {
  homeStore.use();
  const [statsSessions, setStatsSessions] = useState(null);
  const [statsChecks, setStatsChecks] = useState(null);
  const [usageWeek, setUsageWeek] = useState(null);
  const [usageToday, setUsageToday] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!homeView.shown()) return;
      try {
        const [sessRes, checksRes, weekRes, todayRes, auditRes] = await Promise.all([
          rpc('stats.sessions', { project_id: ui.projectId, days: 14 }, true),
          rpc('stats.checks', { project_id: ui.projectId, days: 14 }, true),
          rpc('usage.summary', { window: 'week' }, true),
          rpc('usage.summary', { window: 'today' }, true),
          rpc('audit.list', { project_id: ui.projectId, limit: 8 }, true),
        ]);
        if (!active) return;
        setStatsSessions(sessRes?.result || null);
        setStatsChecks(checksRes?.result || null);
        setUsageWeek(weekRes?.result || null);
        setUsageToday(todayRes?.result || null);
        if (auditRes?.result?.rows) setAuditRows(auditRes.result.rows);
        setLoading(false);
      } catch {
        if (!active) return;
        setError(true);
        setLoading(false);
      }
    };
    setLoading(true);
    setError(false);
    void load();
    const iv = setInterval(() => { void load(); }, 60000);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [ui.projectId, homeView.shown()]);

  if (!homeView.shown()) return null;
  const s = ui.snap || {};
  const mine = (s.sessions || []).filter((x) => x.state !== 'exited' && !ui.pendingHide?.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  const waiting = waitingAll();
  const working = mine.filter((x) => x.state === 'working' || x.state === 'starting');
  const alerts = (s.needs_you || []).filter((n) => !n.read_at && !isInfo(n));
  const approvals = s.approvals || [];
  const needsCount = waiting.length + approvals.length + alerts.length;

  const usdVal = Number(usageToday?.usd) || 0;
  const usdEst = Boolean(usageToday?.usd_estimated);
  const tokensVal = Number(usageToday?.total) || 0;

  const recentSessions = (s.sessions || [])
    .slice()
    .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
    .slice(0, 8);

  const name = project()?.name || '';

  return (
    <div className="ou-col ou-home">
      <header className="ou-dash-header">
        <div className="ou-dash-head-left">
          <span className="ou-dash-title">HOME</span>
          <span className="ou-dash-proj">{name}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          label="New task"
          tooltip="New task (Ctrl+N)"
          onClick={openNewTask}
        />
      </header>

      <UsageWarn />

      <section className="ou-dash-section">
        <div className="ou-dash-section-label">AGENTS</div>
        {mine.length ? (
          <div className="ou-cards ou-dash-cards">
            {mine.map((x) => <AgentCard key={x.id} x={x} />)}
          </div>
        ) : (
          <EmptyState
            title="No agents yet"
            description="Start one with New task (Ctrl+N)."
            isCompact
          />
        )}
      </section>

      <div className="ou-tiles ou-dash-tiles">
        <DashTile
          icon="needs"
          label="Needs you"
          value={needsCount}
          sub={`${waiting.length} waiting, ${alerts.length} alerts`}
          hot={needsCount > 0}
        />
        <DashTile
          icon="working"
          label="Working"
          value={working.length}
          sub={working.length ? `${working.length} running now` : 'none running'}
        />
        <DashTile
          icon="dollar"
          label="Today spend"
          value={`${usdEst ? '~' : ''}$${usdVal.toFixed(2)}`}
          sub={`${formatTokens(tokensVal)} tokens today`}
        />
        <DashTile
          icon="shield"
          label="Approvals"
          value={approvals.length}
          sub={approvals.length ? 'waiting for a yes' : 'none waiting'}
        />
      </div>

      <div className="ou-dash-charts">
        <ChartRuns data={statsSessions} loading={loading} error={error} />
        <ChartTokens data={usageWeek} loading={loading} error={error} />
        <ChartSessions data={statsSessions} loading={loading} error={error} />
        <ChartChecks data={statsChecks} loading={loading} error={error} />
      </div>

      <div className="ou-dash-split">
        <section>
          <div className="ou-dash-section-head">RECENT ACTIVITY</div>
          {auditRows.length ? (
            <div className="ou-dash-list">
              {auditRows.map((r) => (
                <div key={r.id || `${r.at}-${r.agent}`} className="ou-dash-row">
                  <span className={`ou-dash-dot ${r.source === 'agent' ? 'ou-dash-dot-agent' : 'ou-dash-dot-system'}`} />
                  <span className="ou-dash-agent-name">{r.agent}</span>
                  <span className="ou-dash-row-text">{`${r.action || ''}${r.detail ? ` ${r.detail}` : ''}`}</span>
                  <span className="ou-dash-row-time">{ago(r.at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ou-dash-muted">No activity yet.</p>
          )}
        </section>
        <section>
          <div className="ou-dash-section-head">RECENT SESSIONS</div>
          {recentSessions.length ? (
            <div className="ou-dash-list">
              {recentSessions.map((x) => (
                <div
                  key={x.id}
                  className="ou-dash-row"
                  data-action="pick"
                  data-id={x.id}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`ou-dash-dot ou-dash-dot-${x.state}`} />
                  <span
                    className="ou-dash-row-text"
                    style={{ fontWeight: x.state === 'waiting_for_you' ? 600 : 400, color: x.state === 'waiting_for_you' ? 'var(--ink)' : 'inherit' }}
                  >
                    {taskOf(x)}
                  </span>
                  <span className="ou-dash-chip-sm">{x.engine_id}</span>
                  <span className="ou-dash-row-time">{ago(x.state_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ou-dash-muted">No sessions yet.</p>
          )}
        </section>
      </div>

      <Usage />
      <Audit />
    </div>
  );
}
