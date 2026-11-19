import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Drop, press } from './home.jsx';
import { approvalInput, approvalText, baselineOf, chatModeOf, fileTotals, groupItems, liveChunks, mergeEcho, paceFor, pollDelay, revealSteps, splitLabel, TERMINAL_ONLY_NOTE } from './chat-model.js';
import { canMove } from './motion.js';
import { NOT_SENT } from './words.js';
import { ChevronRightIcon } from './icons/index.js';
import { ExternalLinkIcon } from './icons/screens.jsx';

const sessions = new Map();
const sessionOf = (id) => {
  if (!sessions.has(id)) sessions.set(id, { items: [], echoes: [], listeners: new Set(), polls: new Set() });
  return sessions.get(id);
};

export function echoSend(id, text) {
  const session = sessionOf(id);
  const seen = session.items.filter((item) => item.kind === 'user' && item.text.trim() === text.trim()).map((item) => item.id ?? null);
  session.echoes.push({ text, seen, at: Date.now() });
  session.listeners.forEach((notify) => notify());
  session.polls.forEach((poll) => void poll());
}

export function useChat(id, state) {
  const [chat, setChat] = useState(null);
  const [, refresh] = useState(0);
  const latestState = useRef(state);
  const wake = useRef(null);
  latestState.current = state;
  useEffect(() => {
    const session = sessionOf(id);
    const notify = () => refresh((n) => n + 1);
    let stopped = false;
    let timer;
    let delay;
    let request = 0;
    const poll = async () => {
      clearTimeout(timer);
      timer = undefined;
      const current = ++request;
      try {
        const r = await rpc('session.chat', { session_id: id }, true);
        if (stopped || current !== request) return;
        if (r?.result) {
          session.items = r.result.items || [];
          setChat(r.result);
        } else setChat((prev) => prev?.session_id === id ? prev : { session_id: id, error: true });
      } catch {
        if (!stopped && current === request) setChat((prev) => prev?.session_id === id ? prev : { session_id: id, error: true });
      }
      if (!stopped && current === request) {
        delay = pollDelay({ state: latestState.current, pending: session.echoes.length, hidden: document.hidden });
        timer = setTimeout(poll, delay);
      }
    };
    wake.current = () => {
      if (timer !== undefined && delay === 1500 && !document.hidden) void poll();
    };
    const visible = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', visible);
    session.listeners.add(notify);
    session.polls.add(poll);
    void poll();
    return () => { stopped = true; clearTimeout(timer); wake.current = null; document.removeEventListener('visibilitychange', visible); session.listeners.delete(notify); session.polls.delete(poll); };
  }, [id]);
  useEffect(() => {
    if (state === 'working' || state === 'starting') wake.current?.();
  }, [state]);
  return chat?.session_id === id ? chat : null;
}

function Reveal({ text, initial, animate, onStep }) {
  const ref = useRef(null);
  const previous = useRef(text);
  const shown = useRef(initial);
  const sequence = useRef(0);
  const chunks = useRef([]);
  const [view, setView] = useState({ shown: initial, chunks: [] });
  useLayoutEffect(() => {
    const replaced = !text.startsWith(previous.current);
    previous.current = text;
    if (!animate || replaced || !canMove(ref.current)) {
      shown.current = text.length;
      chunks.current = [];
      setView({ shown: text.length, chunks: [] });
      return;
    }
    const steps = revealSteps(shown.current, text, paceFor(text.slice(shown.current)));
    if (!steps.length && !chunks.current.length) return;
    let frame;
    let start;
    let index = 0;
    const tick = (now) => {
      start ??= now;
      chunks.current = liveChunks(chunks.current, now, 120);
      while (index < steps.length && steps[index].at <= now - start) {
        const len = steps[index++].len;
        chunks.current.push({ from: shown.current, len, born: now, key: sequence.current++ });
        shown.current = len;
      }
      setView({ shown: shown.current, chunks: [...chunks.current] });
      if (index < steps.length || chunks.current.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, animate]);
  useLayoutEffect(() => { onStep(); }, [view, onStep]);
  const settled = view.chunks[0]?.from ?? view.shown;
  return <p ref={ref} className="ou-hm-chattext">{text.slice(0, settled)}{view.chunks.map((chunk) => <span className="ou-hm-fresh" key={chunk.key}>{text.slice(chunk.from, chunk.len)}</span>)}</p>;
}

function ToolRow({ item }) {
  const [open, setOpen] = useState(item.status === 'error');
  useEffect(() => { if (item.status === 'error') setOpen(true); }, [item.status]);
  const { verb, arg } = splitLabel(item.label);
  return <div className="ou-hm-toolrow">
    <div className="ou-hm-tool" title={item.label} aria-expanded={open} {...press(() => setOpen(!open))}>
      <span><span className="ou-hm-toolverb">{verb}</span>{arg ? <> <code>{arg}</code></> : null}</span>
      {item.status === 'error' ? <span className="ou-hm-bad">failed</span> : item.status === 'running' ? <span>working</span> : null}
      <span className="ou-hm-chevbox" data-open={String(open)}><ChevronRightIcon size={14} /></span>
    </div>
    <Drop open={open} ms={250} rows=":scope > *" className="ou-hm-drop ou-hm-tooloutput">{item.output?.length ? item.output.map((line, i) => <div key={i} className={item.status === 'error' && i === 0 ? 'ou-hm-bad' : undefined}>{line}</div>) : <div>{item.name} · {item.status === 'ok' ? 'finished' : item.status === 'error' ? 'failed' : item.status === 'running' ? 'working' : item.status}</div>}</Drop>
  </div>;
}

function EditCard({ item, total, openFile }) {
  return <div className="ou-hm-edit">
    <div className="ou-hm-edithead">
      <strong>Edited</strong><code title={item.file}>{item.file}</code>
      {item.preview ? <span className="ou-hm-editcounts"><span className="ou-hm-add">+{item.preview.added}</span> <span className="ou-hm-del">-{item.preview.removed}</span></span> : null}
      {total?.edits > 1 ? <span className="ou-hm-filetotal">· file +{total.added} -{total.removed}</span> : null}
      {item.status === 'error' ? <span className="ou-hm-bad">failed</span> : null}
      <Button size="sm" variant="ghost" label="Open in IDE" endContent={<ExternalLinkIcon size={14} />} onClick={() => void openFile(item.file)} />
    </div>
    {item.preview ? <div className="ou-hm-diff">
      {item.preview.lines.map((line, i) => <div key={i} className={line.sign === '+' ? 'ou-hm-add' : 'ou-hm-del'}>{line.sign} {line.text}</div>)}
      {item.preview.more > 0 ? <div className="ou-hm-diffmore">{item.preview.more} more lines</div> : null}
    </div> : null}
    {item.output !== undefined ? <ToolRow item={item} /> : null}
  </div>;
}

function ToolSteps({ item }) {
  const [open, setOpen] = useState(false);
  return <div className="ou-hm-chatsteps">
    <div className="ou-hm-tool" aria-expanded={open} {...press(() => setOpen(!open))}>
      <span>{item.label}</span><span className="ou-hm-chevbox" data-open={String(open)}><ChevronRightIcon size={14} /></span>
    </div>
    <Drop open={open} ms={250} rows=":scope > *" className="ou-hm-drop ou-hm-chatsteplist">{item.items.map((step) => <ToolRow key={step.id} item={step} />)}</Drop>
  </div>;
}

function Approval({ item, x, engine }) {
  const [sending, setSending] = useState(false);
  const answered = useRef(false);
  const send = async (allow) => {
    const input = approvalInput(engine, allow);
    if (input === null || answered.current) return;
    answered.current = true;
    setSending(true);
    try {
      if (await troop.termInput(x.id, input)) return;
      toast(NOT_SENT, true);
    }
    catch (err) { toast(String(err?.message || err), true); }
    answered.current = false;
    setSending(false);
  };
  return <div className="ou-hm-approval">
    <p>{item.name === 'Bash' || item.name === 'PowerShell' ? 'Allow Claude to run:' : 'Allow Claude to:'}</p>
    <code className="ou-hm-approvaltext">{approvalText(item)}</code>
    <div className="ou-hm-chatactions">
      <Button size="sm" variant="primary" icon={<span className="ou-hm-keyhint">1</span>} label="Allow" isDisabled={sending || approvalInput(engine, true) === null} onClick={() => void send(true)} />
      <Button className="ou-hm-deny" size="sm" variant="secondary" icon={<span className="ou-hm-keyhint">Esc</span>} label="Deny" isDisabled={sending || approvalInput(engine, false) === null} onClick={() => void send(false)} />
    </div>
  </div>;
}

export function Chat({ x, chat, openInEditor }) {
  const ref = useRef(null);
  const pinned = useRef(true);
  const baseline = useRef({ id: x.id, lengths: null });
  if (baseline.current.id !== x.id) baseline.current = { id: x.id, lengths: null };
  if (chat?.items) baseline.current.lengths = baselineOf(baseline.current.lengths, chat.items);
  const lastEcho = useRef(null);
  const session = sessionOf(x.id);
  const merged = mergeEcho(chat?.items || [], session.echoes, Date.now());
  session.echoes = merged.pending;
  const items = groupItems(merged.items);
  const lastText = items.findLastIndex((item) => item.kind === 'text');
  let userIndex = 0;
  let echoIndex = 0;
  let textIndex = 0;
  const signature = JSON.stringify(merged.items);
  const pin = useCallback(() => {
    const host = ref.current?.closest('.ou-hm-center');
    if (host && pinned.current) host.scrollTop = host.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    const host = ref.current?.closest('.ou-hm-center');
    if (!host) return;
    pinned.current = true;
    const scroll = () => { pinned.current = host.scrollHeight - host.scrollTop - host.clientHeight < 48; };
    host.addEventListener('scroll', scroll);
    return () => host.removeEventListener('scroll', scroll);
  }, [x.id]);
  useLayoutEffect(() => {
    const echo = session.echoes.at(-1);
    const host = ref.current?.closest('.ou-hm-center');
    if (echo && echo !== lastEcho.current && host) {
      pinned.current = true;
      host.scrollTo({ top: host.scrollHeight, behavior: canMove(host) ? 'smooth' : 'auto' });
    } else pin();
    lastEcho.current = echo;
  }, [x.id, signature, pin]);
  const openFile = async (file) => {
    const project = (ui.snap?.projects || []).find((p) => p.id === x.project_id);
    const root = String(ui.snap?.git?.[x.id]?.root || project?.path || '').replace(/\\/g, '/').replace(/\/$/, '');
    const path = file.replace(/\\/g, '/');
    const rel = root && path.toLowerCase().startsWith(root.toLowerCase() + '/') ? path.slice(root.length + 1) : path;
    try { await openInEditor(x); await ideView.open(rel); }
    catch (err) { toast(String(err?.message || err), true); }
  };
  const engine = chat?.engine_id || x.engine_id;
  const totals = fileTotals(chat?.items || []);
  return <div ref={ref} className="ou-hm-chat">
    {!chat && !merged.pending.length ? <p className="ou-hm-chatnote" role="status">Loading chat…</p> : chat?.error && !merged.pending.length ? <p className="ou-hm-chatnote" role="status">Could not load chat. Retrying…</p> : chat && !chat.error && chatModeOf(engine, chat.source) === 'terminal' ? <p className="ou-hm-chatnote">{TERMINAL_ONLY_NOTE}</p> : items.map((item, i) => {
      if (item.kind === 'user') return <div key={`${x.id}:${item.echo ? `echo:${echoIndex++}` : item.id ?? `user:${userIndex++}`}`} className="ou-hm-user" data-echo={item.echo ? 'true' : undefined}><p>{item.text}</p></div>;
      if (item.kind === 'text') {
        const index = textIndex++;
        const key = item.id ?? `text:${index}`;
        return <Reveal key={`${x.id}:${key}`} text={item.text} initial={baseline.current.lengths?.get(key) ?? 0} animate={i === lastText} onStep={pin} />;
      }
      if (item.kind === 'steps') return <ToolSteps key={item.id} item={item} />;
      if (item.status === 'waiting') return <Approval key={item.id} item={item} x={x} engine={engine} />;
      if (item.file) return <EditCard key={item.id} item={item} total={totals[item.file]} openFile={openFile} />;
      return <ToolRow key={item.id} item={item} />;
    })}
  </div>;
}
