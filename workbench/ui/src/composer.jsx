// From bb (MIT), plugins/composer/src/PromptBoxInternal.tsx and apps/app/src/components/promptbox/ThreadEnvironmentSummary.tsx
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { PlusIcon, ExpandIcon, ReturnIcon, engineName } from './icons/index.js';

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

// A render function, not a component: callers keep their own labelled fields and the test harnesses see every control.
export function composer({ field, opts, plus, attach, engine, send, context, status, filled, strip = false, className = '', onKeyDown }) {
  const key = className.split(' ')[0] || 'cmp';
  const items = attach ? [{ label: 'Attach files', onClick: () => document.querySelector(`input[data-attach="${key}"]`)?.click() }, ...(plus || [])] : plus;
  return (
    <div className={`ou-cmp-wrap${strip ? ' ou-cmp-strip' : ''} ${className}`}>
      <div className="ou-composer ou-cmp" data-filled={filled ? 'true' : 'false'} onKeyDown={onKeyDown}
        onDragOver={attach ? (e) => e.preventDefault() : undefined} onDrop={attach ? (e) => { e.preventDefault(); attach(api.filePaths([...e.dataTransfer.files])); } : undefined}>
        {field}
        {attach ? <input type="file" multiple hidden data-attach={key} onChange={(e) => { attach(api.filePaths([...e.target.files])); e.target.value = ''; }} /> : null}
        <span className="ou-cmp-expand"><IconButton size="sm" variant="ghost" icon={expandIcon} label="Expand" aria-pressed="false" onClick={expand} /></span>
        {opts}
        <div className="ou-cmp-bar ou-hm-cbar">
          {items ? <DropdownMenu size="sm" menuWidth={200} items={items} renderTrigger={(p) => <IconButton {...p} size="sm" variant="ghost" icon={plusIcon} label="Add" />} /> : null}
          {engine?.readOnly ? (
            <span className="ou-cmp-engine ou-cmp-ro" title={`Answering ${engineName(engine.id)}`}><b>{engineName(engine.id)}</b></span>
          ) : engine ? (
            <span className="ou-cmp-engine">
              <Selector label="Agent" isLabelHidden size="sm" variant="ghost" placement="above" options={engine.options} value={engine.id} onChange={engine.onChange}
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
