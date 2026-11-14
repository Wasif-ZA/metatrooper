import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Drop, press } from './home.jsx';
import { approvalInput, approvalText, chatModeOf, groupItems, splitLabel, TERMINAL_ONLY_NOTE } from './chat-model.js';
import { NOT_SENT } from './words.js';
import { ChevronRightIcon } from './icons/index.js';

export function useChat(id) {
  const [chat, setChat] = useState(null);
  useEffect(() => {
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const r = await rpc('session.chat', { session_id: id }, true);
        if (!stopped && r?.result) setChat(r.result);
        else if (!stopped) setChat((prev) => prev?.session_id === id ? prev : { session_id: id, error: true });
      } catch {
        if (!stopped) setChat((prev) => prev?.session_id === id ? prev : { session_id: id, error: true });
      }
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id]);
  return chat?.session_id === id ? chat : null;
}

function ToolRow({ item }) {
  const [open, setOpen] = useState(item.status === 'error');
  useEffect(() => { if (item.status === 'error') setOpen(true); }, [item.status]);
  const { verb, arg } = splitLabel(item.label);
  const hasOutput = item.output !== undefined;
  return <div className="ou-hm-toolrow">
    <div className="ou-hm-tool" title={item.label} aria-expanded={hasOutput ? open : undefined} {...(hasOutput ? press(() => setOpen(!open)) : {})}>
      <span><strong>{verb}</strong>{arg ? <> <code>{arg}</code></> : null}</span>
      {item.status === 'error' ? <span className="ou-hm-bad">failed</span> : item.status === 'running' ? <span>working</span> : null}
      {hasOutput ? <span className="ou-hm-chevbox" data-open={String(open)}><ChevronRightIcon size={14} /></span> : null}
    </div>
    {hasOutput ? <Drop open={open} className="ou-hm-drop ou-hm-tooloutput">{item.output.map((line, i) => <div key={i} className={i === 0 ? 'ou-hm-bad' : undefined}>{line}</div>)}</Drop> : null}
  </div>;
}

function EditCard({ item, openFile }) {
  return <div className="ou-hm-edit">
    <div className="ou-hm-edithead">
      <strong>Edited</strong><code title={item.file}>{item.file}</code>
      {item.preview ? <span className="ou-hm-editcounts"><span className="ou-hm-add">+{item.preview.added}</span> <span className="ou-hm-del">-{item.preview.removed}</span></span> : null}
      {item.status === 'error' ? <span className="ou-hm-bad">failed</span> : null}
      <Button size="sm" variant="ghost" label="Open in IDE" onClick={() => void openFile(item.file)} />
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
    <Drop open={open} className="ou-hm-drop ou-hm-chatsteplist">{item.items.map((step) => <ToolRow key={step.id} item={step} />)}</Drop>
  </div>;
}

function Approval({ item, x, engine }) {
  const [sending, setSending] = useState(false);
  const send = async (allow) => {
    const input = approvalInput(engine, allow);
    if (input === null || sending) return;
    setSending(true);
    try { if (!(await troop.termInput(x.id, input))) toast(NOT_SENT, true); }
    catch (err) { toast(String(err?.message || err), true); }
    finally { setSending(false); }
  };
  return <div className="ou-hm-approval">
    <p>{item.name === 'Bash' || item.name === 'PowerShell' ? 'Allow Claude to run:' : 'Allow Claude to:'}</p>
    <code className="ou-hm-approvaltext">{approvalText(item)}</code>
    <div className="ou-hm-chatactions">
      <Button size="sm" variant="primary" label="Allow" isDisabled={sending || approvalInput(engine, true) === null} onClick={() => void send(true)} />
      <Button className="ou-hm-deny" size="sm" variant="secondary" label="Deny" isDisabled={sending || approvalInput(engine, false) === null} onClick={() => void send(false)} />
    </div>
  </div>;
}

export function Chat({ x, chat, openInEditor }) {
  const ref = useRef(null);
  const pinned = useRef(true);
  const signature = JSON.stringify(chat?.items);
  useLayoutEffect(() => {
    const host = ref.current?.closest('.ou-hm-center');
    if (!host) return;
    pinned.current = true;
    const scroll = () => { pinned.current = host.scrollHeight - host.scrollTop - host.clientHeight < 48; };
    host.addEventListener('scroll', scroll);
    return () => host.removeEventListener('scroll', scroll);
  }, [x.id]);
  useLayoutEffect(() => {
    const host = ref.current?.closest('.ou-hm-center');
    if (host && pinned.current) host.scrollTop = host.scrollHeight;
  }, [x.id, signature]);
  const openFile = async (file) => {
    const project = (ui.snap?.projects || []).find((p) => p.id === x.project_id);
    const root = String(ui.snap?.git?.[x.id]?.root || project?.path || '').replace(/\\/g, '/').replace(/\/$/, '');
    const path = file.replace(/\\/g, '/');
    const rel = root && path.toLowerCase().startsWith(root.toLowerCase() + '/') ? path.slice(root.length + 1) : path;
    try { await openInEditor(x); await ideView.open(rel); }
    catch (err) { toast(String(err?.message || err), true); }
  };
  const engine = chat?.engine_id || x.engine_id;
  return <div ref={ref} className="ou-hm-chat">
    {!chat ? <p className="ou-hm-chatnote" role="status">Loading chat…</p> : chat.error ? <p className="ou-hm-chatnote" role="status">Could not load chat. Retrying…</p> : chatModeOf(engine, chat.source) === 'terminal' ? <p className="ou-hm-chatnote">{TERMINAL_ONLY_NOTE}</p> : groupItems(chat.items).map((item, i) => {
      if (item.kind === 'user') return <div key={i} className="ou-hm-user"><p>{item.text}</p></div>;
      if (item.kind === 'text') return <p key={i} className="ou-hm-chattext">{item.text}</p>;
      if (item.kind === 'steps') return <ToolSteps key={item.id} item={item} />;
      if (item.status === 'waiting') return <Approval key={item.id} item={item} x={x} engine={engine} />;
      if (item.file) return <EditCard key={item.id} item={item} openFile={openFile} />;
      return <ToolRow key={item.id} item={item} />;
    })}
  </div>;
}
