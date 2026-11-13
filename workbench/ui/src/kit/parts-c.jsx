import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup';
import { Card } from '@astryxdesign/core/Card';
import { ChatMessage, ChatMessageBubble } from '@astryxdesign/core/Chat';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Code } from '@astryxdesign/core/Code';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Heading } from '@astryxdesign/core/Heading';
import { Item } from '@astryxdesign/core/Item';
import { List, ListItem } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { fallback } from './check.js';
import { Plain } from './Draw.jsx';
import './parts-c.css';

const TO = 'goes to the agent';
const nop = () => {};
const S = (v) => String(v);
const isStr = (v) => typeof v === 'string' || typeof v === 'number';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (map, v, d) => (typeof v === 'string' && Object.hasOwn(map, v) ? map[v] : d);

/** Draws each item that passes `ok`; a bad item becomes a Plain box on its own. */
const each = (arr, cap, ok, draw, why) => arr.slice(0, cap).map((x, i) => {
  try { if (ok(x)) return draw(x, i); } catch {}
  return <Plain key={`bad${i}`} f={fallback(x, why)} />;
});

function Acts({ a }) {
  if (!Array.isArray(a) || !a.length) return null;
  return (
    <ButtonGroup label="Actions">
      {each(a, 12, (b) => isObj(b) && isStr(b.label), (b, i) => <Button key={i} label={S(b.label)} variant={b.primary === true ? 'primary' : 'secondary'} />, 'bad button')}
    </ButtonGroup>
  );
}

const CHECK = { done: true, needs: 'indeterminate', skip: false, open: false };
const CHECK_TAG = { needs: 'needs a look', skip: 'skipped' };
const AGENT = { idle: ['neutral', 'idle'], working: ['accent', 'working'], needs: ['neutral', 'waiting'], done: ['success', 'done'] };
const TOOL = { run: ['accent', 'running'], ok: ['success', 'ok'], fail: ['error', 'failed'], wait: ['neutral', 'waiting'] };
const SEV = { high: 'error', med: 'info', low: 'neutral' };
const HAND = { you: ['info', 'you'], run: ['neutral', 'ran'], info: ['neutral', 'note'] };
const TONE = { plain: '', mark: 'ou-pc-mark', done: 'ou-pc-done' };
const DAY = ['ou-pc-d0', 'ou-pc-d1', 'ou-pc-d2', 'ou-pc-d3', 'ou-pc-d4', 'ou-pc-d5', 'ou-pc-d6'];
const COLS = ['', 'ou-pc-n1', 'ou-pc-n2', 'ou-pc-n3', 'ou-pc-n4', 'ou-pc-n5', 'ou-pc-n6', 'ou-pc-n7'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function Field({ p }) {
  const label = S(p.label);
  const v = p.value === undefined ? '' : S(p.value);
  const ph = p.placeholder === undefined ? undefined : S(p.placeholder);
  const n = Number(v);
  switch (p.kind) {
    case 'longtext': return <TextArea label={label} value={v} placeholder={ph} description={TO} onChange={nop} rows={3} isReadOnly />;
    case 'check': return <CheckboxInput label={label} value={v === 'yes'} description={TO} onChange={nop} isReadOnly />;
    case 'number':
    case 'money':
      if (v === '' || Number.isFinite(n)) return <NumberInput label={label} value={v === '' ? null : n} placeholder={ph} description={TO} onChange={nop} isReadOnly formatValue={p.kind === 'money' ? (x) => `$${x.toLocaleString('en-AU')}` : undefined} />;
      break;
    case 'date':
      if (v === '' || ISO_DATE.test(v)) return <DateInput label={label} value={v || undefined} placeholder={ph} description={TO} onChange={nop} />;
      break;
    case 'select': {
      const opts = Array.isArray(p.options) ? p.options.slice(0, 50) : [];
      const good = opts.filter(isStr).map((o) => ({ value: S(o), label: S(o) }));
      return (
        <VStack gap={1}>
          <Selector label={label} options={good} value={good.some((o) => o.value === v) ? v : undefined} placeholder={ph} description={TO} onChange={nop} />
          {opts.map((o, i) => (isStr(o) ? null : <Plain key={i} f={fallback(o, 'bad option')} />))}
        </VStack>
      );
    }
    default:
  }
  return <TextInput type="text" label={label} value={v} placeholder={ph} description={TO} onChange={nop} isReadOnly />;
}

function Calendar({ p }) {
  const days = p.days.slice(0, 7);
  const bad = [];
  const ev = p.events.slice(0, 200).filter((e, i) => {
    const ok = isObj(e) && Number.isInteger(e.day) && e.day >= 0 && e.day < days.length && isStr(e.title) && (e.time === undefined || isStr(e.time));
    if (!ok) bad.push(<Plain key={`bad${i}`} f={fallback(e, 'bad event')} />);
    return ok;
  });
  return (
    <div className="ou-pc-cal">
      <div className={`ou-pc-week ${COLS[days.length] || ''}`}>
        {days.map((d, i) => (
          <div key={i} className={`ou-pc-day ${DAY[i]}`}>
            <Text type="label">{isStr(d) ? S(d) : '?'}</Text>
            {ev.filter((e) => e.day === i).map((e, j) => (
              <div key={j} className={`ou-pc-ev ${pick(TONE, e.tone, '')}`}>
                {e.time !== undefined ? <Text size="sm" color="secondary">{S(e.time)}</Text> : null}
                <Text size="sm">{S(e.title)}</Text>
              </div>
            ))}
          </div>
        ))}
      </div>
      {days.map((d, i) => (isStr(d) ? null : <Plain key={`d${i}`} f={fallback(d, 'bad day')} />))}
      {bad}
    </div>
  );
}

function Preview({ p }) {
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const labels = Array.isArray(p.labels) ? p.labels : [];
  const figs = Array.isArray(p.figures) ? p.figures.filter(isStr).slice(0, 8) : [];
  return (
    <Card padding={0} variant="default">
      <div className="ou-pc-pvbar">
        <Text type="label">{S(p.title)}</Text>
        {p.url !== undefined ? <Code color="secondary">{S(p.url)}</Code> : null}
        <span className="ou-pc-sp" />
        {Array.isArray(p.versions) ? each(p.versions, 8, isStr, (v, i) => <Badge key={`v${i}`} variant={i === p.versions.length - 1 ? 'info' : 'neutral'} label={S(v)} />, 'bad version') : null}
        {Array.isArray(p.widths) ? each(p.widths, 8, isStr, (w, i) => <Badge key={`w${i}`} variant={i ? 'neutral' : 'info'} label={S(w)} />, 'bad width') : null}
      </div>
      <div className="ou-pc-stage">
        <Text size="sm" color="secondary">{`${p.kind}${p.still ? ` · ${p.still}` : ''} preview`}</Text>
        {each(lines, 40, isStr, (l, i) => (
          <div key={i} className="ou-pc-wl">
            {i ? <Text size="sm">{S(l)}</Text> : <Text type="label">{S(l)}</Text>}
            {isStr(labels[i]) ? <Badge variant="neutral" label={S(labels[i])} /> : null}
          </div>
        ), 'bad line')}
        {figs.length ? <Text size="sm" color="secondary">{figs.map(S).join(' · ')}</Text> : null}
      </div>
      {Array.isArray(p.marks) ? (
        <div className="ou-pc-marks">
          <List listStyle="decimal" density="compact">
            {each(p.marks, 40, (m) => isObj(m) && isStr(m.text) && (m.time === undefined || isStr(m.time)), (m, i) => <ListItem key={i} label={S(m.text)} description={m.time !== undefined ? S(m.time) : undefined} />, 'bad mark')}
          </List>
        </div>
      ) : null}
    </Card>
  );
}

export default {
  toggle: ({ p }) => <Switch label={S(p.label)} value={p.on} description={p.note !== undefined ? S(p.note) : undefined} onChange={nop} />,

  check: ({ p }) => (
    <div className="ou-pc-row">
      <CheckboxInput label={S(p.label)} value={pick(CHECK, p.state, false)} description={p.value !== undefined ? S(p.value) : undefined} onChange={nop} isReadOnly />
      {pick(CHECK_TAG, p.state, null) ? <Badge variant="neutral" label={CHECK_TAG[p.state]} /> : null}
    </div>
  ),

  choice: ({ p }) => {
    const opts = p.options.slice(0, 6);
    const ok = (o) => isObj(o) && isStr(o.title) && (o.note === undefined || isStr(o.note));
    return (
      <Card padding={4}>
        <VStack gap={3}>
          <Text size="sm" color="secondary">{`The agent is asking · your answer ${TO}`}</Text>
          <RadioList label={S(p.question)} value={Number.isInteger(p.picked) && ok(opts[p.picked]) ? String(p.picked) : ''} onChange={nop}>
            {opts.map((o, i) => (ok(o) ? <RadioListItem key={i} value={String(i)} label={`${i + 1} · ${S(o.title)}`} description={o.note !== undefined ? S(o.note) : undefined} /> : null))}
          </RadioList>
          {opts.map((o, i) => (ok(o) ? null : <Plain key={i} f={fallback(o, 'bad option')} />))}
          {p.field !== undefined ? <TextInput type="text" label={S(p.field)} value="" description={TO} onChange={nop} isReadOnly /> : null}
          <Acts a={p.actions || [{ label: 'Send', primary: true }]} />
        </VStack>
      </Card>
    );
  },

  field: Field,
  calendar: Calendar,

  meter: ({ p }) => {
    const pre = p.prefix !== undefined ? S(p.prefix) : '';
    const unit = p.unit !== undefined ? ` ${S(p.unit)}` : '';
    const max = p.max > 0 ? p.max : 0;
    return (
      <ProgressBar
        label={S(p.label)} value={max ? Math.max(0, Math.min(p.value, max)) : 0} max={max || 1} hasValueLabel
        variant={max && p.value > max ? 'error' : 'accent'}
        formatValueLabel={() => `${pre}${p.value.toLocaleString('en-AU')} of ${pre}${p.max.toLocaleString('en-AU')}${unit}`}
      />
    );
  },

  thread: ({ p }) => (
    <Card padding={3}>
      <VStack gap={2}>
        <div className="ou-pc-row">
          <Code>{`${S(p.path)}${Number.isFinite(p.line) ? `:${p.line}` : ''}`}</Code>
          {p.resolved ? <Badge variant="success" label="resolved" /> : null}
        </div>
        {each(p.comments, 100, (c) => isObj(c) && isStr(c.who) && isStr(c.text), (c, i) => (
          <ChatMessage key={i} sender="assistant" density="compact" name={S(c.who)} avatar={<Avatar name={S(c.who)} size="sm" />}>
            <ChatMessageBubble variant="ghost">{S(c.text)}</ChatMessageBubble>
          </ChatMessage>
        ), 'bad comment')}
      </VStack>
    </Card>
  ),

  agent: ({ p }) => {
    const [tone, word] = pick(AGENT, p.state, AGENT.idle);
    return (
      <Item
        density="compact" label={S(p.name)} description={p.model !== undefined ? S(p.model) : undefined}
        startContent={<Avatar name={S(p.name)} size="sm" />}
        endContent={<StatusDot variant={tone} label={word} isPulsing={p.state === 'working'} />}
      />
    );
  },

  tool: ({ p }) => {
    const [tone, word] = pick(TOOL, p.state, TOOL.wait);
    return (
      <Card padding={2}>
        <VStack gap={2}>
          <Item
            density="compact" label={S(p.name)} description={p.input !== undefined ? <Code color="secondary">{S(p.input)}</Code> : undefined}
            startContent={<StatusDot variant={tone} label={word} isPulsing={p.state === 'run'} />}
            endContent={Number.isFinite(p.ms) ? <Text size="sm" color="secondary">{`${(p.ms / 1000).toFixed(1)}s`}</Text> : undefined}
          />
          {p.output !== undefined ? <CodeBlock code={S(p.output)} size="sm" maxHeight={200} /> : null}
        </VStack>
      </Card>
    );
  },

  finding: ({ p }) => (
    <Card padding={3}>
      <VStack gap={2}>
        <div className="ou-pc-row">
          <Badge variant={pick(SEV, p.sev, 'neutral')} label={S(p.sev)} />
          <Text type="label">{S(p.title)}</Text>
          <span className="ou-pc-sp" />
          {p.state !== undefined ? <Badge variant="neutral" label={S(p.state)} /> : null}
        </div>
        {p.where !== undefined ? <Code color="secondary">{S(p.where)}</Code> : null}
        {Array.isArray(p.opinions) ? (
          <List density="compact" hasDividers>
            {each(p.opinions, 20, (o) => isObj(o) && isStr(o.engine) && isStr(o.text), (o, i) => <ListItem key={i} label={S(o.text)} startContent={<Badge variant="neutral" label={S(o.engine)} />} />, 'bad opinion')}
          </List>
        ) : null}
        <Acts a={p.actions} />
      </VStack>
    </Card>
  ),

  digest: ({ p }) => (
    <Card padding={3}>
      <VStack gap={2}>
        <Text type="label">{S(p.title)}</Text>
        <Text size="sm">{S(p.facts)}</Text>
        {p.note !== undefined ? <Text size="sm" color="secondary">{S(p.note)}</Text> : null}
        <Acts a={p.actions} />
      </VStack>
    </Card>
  ),

  handback: ({ p }) => (
    <Card padding={3}>
      <VStack gap={2}>
        <Heading level={4}>{p.title !== undefined ? S(p.title) : 'Hand back'}</Heading>
        <List listStyle="decimal" hasDividers>
          {each(p.items, 50, (it) => isObj(it) && isStr(it.text) && (it.command === undefined || isStr(it.command)), (it, i) => {
            const [tone, word] = pick(HAND, it.kind, HAND.info);
            return (
              <ListItem
                key={i} label={S(it.text)} isDisabled={it.done === true}
                description={it.command !== undefined ? <Code>{S(it.command)}</Code> : undefined}
                endContent={<Badge variant={it.done === true ? 'success' : tone} label={it.done === true ? 'done' : word} />}
              />
            );
          }, 'bad item')}
        </List>
      </VStack>
    </Card>
  ),

  preview: Preview,
};
