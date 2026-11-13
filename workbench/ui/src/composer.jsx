// From bb (MIT), plugins/composer/src/PromptBoxInternal.tsx and apps/app/src/components/promptbox/ThreadEnvironmentSummary.tsx
import { useEffect, useRef, useState } from 'react';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { EngineMark, PlusIcon, ExpandIcon, ReturnIcon, engineName } from './icons/index.js';

const plusIcon = <PlusIcon size={16} />;
const expandIcon = <ExpandIcon size={20} />;
const returnIcon = <ReturnIcon size={16} />;

const expand = (e) => {
  const box = e.currentTarget.closest('.ou-cmp');
  const on = box.toggleAttribute('data-expanded');
  e.currentTarget.setAttribute('aria-pressed', String(on));
  box.querySelector('textarea, input')?.focus();
};

export function atRefs(text, paths, root) {
  const base = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const refs = paths.map((p) => {
    const f = p.replace(/\\/g, '/');
    const rel = base && f.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? f.slice(base.length + 1) : f;
    return `@${/\s/.test(rel) ? `"${rel}"` : rel}`;
  });
  return refs.length ? `${text}${text && !/\s$/.test(text) ? ' ' : ''}${refs.join(' ')} ` : text;
}

const TOKEN = /(^|\s)([@/])(\S*)$/;

/** What the caret is inside: an @file or /command token, with where it starts. */
export function tokenAt(text, caret) {
  const m = TOKEN.exec(text.slice(0, caret));
  if (!m || (m[2] === '/' && m[3].includes('/'))) return null;
  return { kind: m[2], query: m[3], start: caret - m[3].length - 1, end: caret };
}

const fileToken = (p) => `@${/\s/.test(p) ? `"${p}"` : p} `;

// @ lists project files (fsFind), / lists this composer's own actions; up/down/enter/tab pick, Esc closes.
function Mentions({ actions }) {
  const ref = useRef(null);
  const [st, setSt] = useState(null);
  const live = useRef(null);
  live.current = st;
  useEffect(() => {
    const ta = ref.current?.closest('.ou-cmp')?.querySelector('textarea');
    if (!ta) return undefined;
    let seq = 0;
    const read = () => {
      const t = ta.selectionStart === ta.selectionEnd ? tokenAt(ta.value, ta.selectionStart) : null;
      const n = ++seq;
      if (!t) { setSt(null); return; }
      if (t.kind === '/') {
        const list = actions().filter((a) => a.label.toLowerCase().includes(t.query.toLowerCase()));
        setSt(list.length ? { ...t, list, i: 0 } : null);
        return;
      }
      if (!t.query) { setSt({ ...t, list: [], i: 0, hint: 'Type to find a file' }); return; }
      void Promise.resolve(api.fsFind(ui.projectId, t.query)).then((files) => {
        if (n !== seq) return;
        const list = [...new Set((files || []).map((p) => String(p).replace(/\\/g, '/')))].slice(0, 8).map((p) => ({ label: p, path: p }));
        setSt(list.length ? { ...t, list, i: 0 } : { ...t, list: [], i: 0, hint: 'No file matches' });
      }, () => { if (n === seq) setSt({ ...t, list: [], i: 0, hint: 'Could not search files' }); });
    };
    const put = (next, caret) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, next);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      ta.setSelectionRange(caret, caret);
    };
    const choose = (s, item) => {
      setSt(null);
      seq++;
      if (s.kind === '@') {
        const token = fileToken(item.path);
        put(ta.value.slice(0, s.start) + token + ta.value.slice(s.end).replace(/^ /, ''), s.start + token.length);
      } else {
        put(ta.value.slice(0, s.start) + ta.value.slice(s.end), s.start);
        item.run();
      }
    };
    const key = (e) => {
      const s = live.current;
      if (!s) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSt(null); seq++; return; }
      if (!s.list.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        setSt({ ...s, i: (s.i + (e.key === 'ArrowDown' ? 1 : s.list.length - 1)) % s.list.length });
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        choose(s, s.list[s.i]);
      }
    };
    const blur = () => setTimeout(() => { if (document.activeElement !== ta) setSt(null); }, 150);
    ta.addEventListener('input', read);
    ta.addEventListener('click', read);
    ta.addEventListener('keydown', key);
    ta.addEventListener('blur', blur);
    ref.current.choose = (i) => { const s = live.current; if (s?.list[i]) choose(s, s.list[i]); };
    return () => { ta.removeEventListener('input', read); ta.removeEventListener('click', read); ta.removeEventListener('keydown', key); ta.removeEventListener('blur', blur); };
  }, []);
  return (
    <span ref={ref} className="ou-cmp-mention" hidden={!st}>
      {st ? (
        <span role="listbox" aria-label={st.kind === '@' ? 'Files' : 'Commands'}>
          {st.list.map((x, i) => <span key={x.label} role="option" aria-selected={i === st.i} onMouseDown={(e) => { e.preventDefault(); ref.current.choose(i); }}>{st.kind === '/' ? `/${x.label}` : x.label}</span>)}
          {!st.list.length ? <span className="ou-cmp-mention-hint">{st.hint}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

// A render function, not a component: callers keep their own labelled fields and the test harnesses see every control.
export function composer({ field, opts, plus, attach, engine, send, context, status, filled, strip = false, className = '', onKeyDown }) {
  const key = className.split(' ')[0] || 'cmp';
  const items = attach ? [{ label: 'Attach files', onClick: () => document.querySelector(`input[data-attach="${key}"]`)?.click() }, ...(plus || [])] : plus;
  return (
    <div className={`ou-cmp-wrap${strip ? ' ou-cmp-strip' : ''} ${className}`}>
      <div className="ou-composer ou-cmp" data-filled={filled ? 'true' : 'false'} onKeyDown={onKeyDown}
        onDragOver={attach ? (e) => e.preventDefault() : undefined} onDrop={attach ? (e) => { e.preventDefault(); attach(api.filePaths([...e.dataTransfer.files])); } : undefined}>
        {field}
        <Mentions actions={() => [
          ...(items || []).map((x) => ({ label: x.label, run: x.onClick })),
          ...(send && !send.isDisabled ? [{ label: send.label, run: send.onClick }] : []),
        ]} />
        {attach ? <input type="file" multiple hidden data-attach={key} onChange={(e) => { attach(api.filePaths([...e.target.files])); e.target.value = ''; }} /> : null}
        <span className="ou-cmp-expand"><IconButton size="sm" variant="ghost" icon={expandIcon} label="Expand" aria-pressed="false" onClick={expand} /></span>
        {opts}
        <div className="ou-cmp-bar ou-hm-cbar">
          {items ? <DropdownMenu size="sm" menuWidth={200} items={items} renderTrigger={(p) => <IconButton {...p} size="sm" variant="ghost" icon={plusIcon} label="Add" />} /> : null}
          {engine?.readOnly ? (
            <span className="ou-cmp-engine ou-cmp-ro" title={`Answering ${engineName(engine.id)}`}><EngineMark id={engine.id} size={16} /><b>{engineName(engine.id)}</b></span>
          ) : engine ? (
            <span className="ou-cmp-engine">
              <Selector label="Agent" isLabelHidden size="sm" variant="ghost" placement="above" options={engine.options} value={engine.id} onChange={engine.onChange}
                startIcon={<EngineMark id={engine.id} size={16} />}
                renderValue={(o) => <span className="ou-cmp-pick"><b>{engineName(engine.id)}</b><span className="ou-cmp-model">{engine.model || 'default'}</span></span>} />
            </span>
          ) : null}
          <span className="ou-hm-cgap" />
          {send ? <IconButton size="sm" variant="secondary" icon={returnIcon} className="ou-cmp-send" {...send} /> : null}
        </div>
      </div>
      {context ? (
        <div className="ou-cmp-ctx">
          {context.filter(Boolean).map((c) => (c.gap ? <span key={c.key} className="ou-hm-cgap" /> : (
            <span key={c.key} className={`ou-cmp-item${c.plain ? ' ou-cmp-plain' : ''}${c.accent ? ' ou-cmp-accent' : ''}`} title={c.title}>{c.icon}{c.node || <span className="ou-cmp-text">{c.text}</span>}</span>
          )))}
          {status ? <span className="ou-cmp-status" data-state={status.state} role="status">{status.label}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
