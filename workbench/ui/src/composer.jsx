// From bb (MIT), plugins/composer/src/PromptBoxInternal.tsx and apps/app/src/components/promptbox/ThreadEnvironmentSummary.tsx
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { EngineMark, PlusIcon, MicIcon, ExpandIcon, ReturnIcon } from './icons/index.js';

const plusIcon = <PlusIcon size={16} />;
const micIcon = <MicIcon size={16} />;
const expandIcon = <ExpandIcon size={14} />;
const returnIcon = <ReturnIcon size={16} />;

const expand = (e) => {
  const box = e.currentTarget.closest('.ou-cmp');
  const on = box.toggleAttribute('data-expanded');
  e.currentTarget.setAttribute('aria-pressed', String(on));
  box.querySelector('textarea, input')?.focus();
};

// A render function, not a component: callers keep their own labelled fields and the test harnesses see every control.
export function composer({ field, opts, plus, engine, send, context, busy, filled, className = '', onKeyDown }) {
  return (
    <div className={`ou-cmp-wrap ${className}`}>
      <div className="ou-composer ou-cmp" data-filled={filled ? 'true' : 'false'} onKeyDown={onKeyDown}>
        {field}
        <span className="ou-cmp-expand"><IconButton size="sm" variant="ghost" icon={expandIcon} label="Expand" aria-pressed="false" onClick={expand} /></span>
        {opts}
        <div className="ou-cmp-bar ou-hm-cbar">
          {plus ? <DropdownMenu size="sm" menuWidth={200} items={plus} renderTrigger={(p) => <IconButton {...p} size="sm" variant="ghost" icon={plusIcon} label="Add" />} /> : null}
          {engine ? (
            <span className="ou-cmp-engine"><EngineMark id={engine.id} size={16} title={engine.id} />
              <Selector label="Agent" isLabelHidden size="sm" variant="ghost" options={engine.options} value={engine.id} onChange={engine.onChange} />
              {engine.model ? <span className="ou-cmp-model">{engine.model}</span> : null}
            </span>
          ) : null}
          <span className="ou-hm-cgap" />
          <IconButton size="sm" variant="ghost" icon={micIcon} label="Voice input" tooltip="Voice input is not built yet" isDisabled className="ou-cmp-mic" />
          {send ? <IconButton size="sm" variant="secondary" icon={returnIcon} className="ou-cmp-send" {...send} /> : null}
        </div>
      </div>
      {context ? (
        <div className="ou-cmp-ctx">
          {context.filter(Boolean).map((c) => (c.gap ? <span key={c.key} className="ou-hm-cgap" /> : (
            <span key={c.key} className={`ou-cmp-item${c.accent ? ' ou-cmp-accent' : ''}`} title={c.title}>{c.icon}{c.node || <span className="ou-cmp-text">{c.text}</span>}</span>
          )))}
          {busy ? <span className="ou-cmp-spin" role="status" aria-label="Starting" /> : null}
        </div>
      ) : null}
    </div>
  );
}
