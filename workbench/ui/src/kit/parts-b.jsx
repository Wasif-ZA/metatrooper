import { Badge } from '@astryxdesign/core/Badge';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Button } from '@astryxdesign/core/Button';
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup';
import { Card } from '@astryxdesign/core/Card';
import { Citation } from '@astryxdesign/core/Citation';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Item } from '@astryxdesign/core/Item';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { FileIcon } from '../icons/screens.jsx';
import { fallback } from './check.js';
import { Plain } from './Draw.jsx';
import './parts-b.css';

const isStr = (v) => typeof v === 'string' || typeof v === 'number';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const opt = (v) => (isStr(v) ? String(v) : null);
const bad = (name, x, why = 'bad item') => <Plain f={{ ...fallback(x, why), name }} />;
const one = (map, v, d) => (Object.hasOwn(map, v) ? map[v] : d);

const PILL = { kept: 'success', dropped: 'neutral', ok: 'success', warn: 'warning', error: 'error', info: 'info', need: 'warning' };
const LOG_STATE = { done: 'ok', run: 'run', fail: 'bad', todo: 'mute' };
const LOG_MARK = { heal: '↻', fail: '✕' };
const DOC_MARK = { added: 'added', flag: 'flag' };
const DIR = { up: '▲', down: '▼', flat: '' };
const ASSET = /^asset:[a-z0-9-]{1,40}$/;

function Actions({ list, name }) {
  return (
    <ButtonGroup label="Actions">
      {list.slice(0, 12).map((a, i) => (isObj(a) && isStr(a.label) ? <Button key={i} label={String(a.label)} variant={a.primary === true ? 'primary' : 'secondary'} /> : <span key={i}>{bad(name, a, 'bad button')}</span>))}
    </ButtonGroup>
  );
}

function trim(x, d, lim) {
  if (x === null || typeof x !== 'object') return x;
  if (d >= lim) return Array.isArray(x) ? `[${x.length} items]` : '{...}';
  if (Array.isArray(x)) return [...x.slice(0, 20).map((y) => trim(y, d + 1, lim)), ...(x.length > 20 ? [`... ${x.length - 20} more`] : [])];
  return Object.fromEntries(Object.entries(x).slice(0, 30).map(([k, y]) => [k, trim(y, d + 1, lim)]));
}

const keyOf = (k) => (k === '+' ? 'plus' : String(k).replace(/\+/g, '').trim());

export default {
  note: ({ p }) => <Text color="secondary" size="sm">{String(p.text)}</Text>,

  headline: ({ p }) => (
    <div className="ou-pb-headline">
      <Heading level={1}>{String(p.text)}</Heading>
      {Array.isArray(p.actions) && p.actions.length ? <Actions list={p.actions} name="headline action" /> : null}
    </div>
  ),

  pill: ({ p }) => <span className="ou-pb-inline"><Badge variant={one(PILL, p.tone, 'neutral')} label={String(p.text)} /></span>,

  kbd: ({ p }) => {
    const keys = p.keys.slice(0, 8);
    const good = keys.filter((k) => isStr(k) && keyOf(k));
    return (
      <span className="ou-pb-kbd">
        {good.length ? <Kbd keys={good.map(keyOf).join('+')} /> : null}
        {p.label != null ? <Text color="secondary" size="sm">{String(p.label)}</Text> : null}
        {keys.filter((k) => !good.includes(k)).map((k, i) => <span key={i}>{bad('kbd key', k, 'bad key')}</span>)}
      </span>
    );
  },

  time: ({ p }) => {
    const iso = String(p.iso);
    if (!Number.isFinite(Date.parse(iso))) return bad('time', p, 'not a date');
    return (
      <span className="ou-pb-time">
        {p.label != null ? <Text weight="semibold" size="sm">{String(p.label)}</Text> : null}
        <Timestamp value={iso} format="relative" hasTooltip size="sm" color="secondary" />
      </span>
    );
  },

  code: ({ p }) => {
    const lang = opt(p.lang)?.toLowerCase().slice(0, 20);
    return <CodeBlock code={String(p.text)} title={opt(p.title) ?? undefined} language={lang || undefined} hasLanguageLabel={!!lang} hasCopyButton={false} maxHeight={420} width="100%" />;
  },

  json: ({ p }) => {
    const lim = Math.max(1, Math.min(6, Math.round(p.depth ?? 3)));
    return <CodeBlock code={JSON.stringify(trim(p.value, 0, lim), null, 2) ?? String(p.value)} language="json" hasCopyButton={false} maxHeight={420} width="100%" />;
  },

  log: ({ p }) => (
    <div className="ou-pb-log" role="log">
      {p.lines.slice(0, 400).map((l, i) => {
        if (!isObj(l) || !isStr(l.text)) return <div key={i}>{bad('log line', l)}</div>;
        const detail = opt(l.detail);
        if (l.kind === 'group') {
          return (
            <div key={i} className={`ou-pb-logrow ou-pb-group ou-pb-${one(LOG_STATE, l.state, 'ok')}`}>
              <span className="ou-pb-dot" />
              <span>{String(l.text)}{detail ? <span className="ou-pb-mute"> {detail}</span> : null}</span>
              <span className="ou-pb-mute">{opt(l.took) ?? ''}</span>
            </div>
          );
        }
        return (
          <div key={i} className={`ou-pb-logrow${l.kind === 'fail' ? ' ou-pb-bad' : ''}`}>
            <span className="ou-pb-mute">{opt(l.time) ?? ''}</span>
            <span className={`ou-pb-mark ou-pb-k-${l.kind === 'heal' || l.kind === 'fail' ? l.kind : 'plain'}`}>{l.kind === 'run' ? <Spinner size="sm" /> : one(LOG_MARK, l.kind, '·')}</span>
            <span>{String(l.text)}{detail ? <span className="ou-pb-mute"> {detail}</span> : null}</span>
          </div>
        );
      })}
    </div>
  ),

  doc: ({ p }) => (
    <article className="ou-pb-doc">
      <div className="ou-pb-dochead">
        <Heading level={3}>{String(p.title)}</Heading>
        {p.by != null ? <Text color="secondary" size="sm">{String(p.by)}</Text> : null}
        {p.status != null ? <Badge variant="neutral" label={String(p.status)} /> : null}
      </div>
      {p.blocks.slice(0, 200).map((b, i) => {
        if (!isObj(b) || !isStr(b.text)) return <div key={i}>{bad('doc block', b)}</div>;
        const refs = Array.isArray(b.refs) ? b.refs.slice(0, 12) : [];
        return (
          <div key={i} className={`ou-pb-para ou-pb-${one(DOC_MARK, b.mark, 'none')}`}>
            <Text display="block">{String(b.text)}</Text>
            {refs.length ? <span className="ou-pb-refs">{refs.map((r, j) => (isStr(r) ? <Token key={j} label={String(r)} size="sm" /> : <span key={j}>{bad('doc ref', r, 'bad ref')}</span>))}</span> : null}
          </div>
        );
      })}
    </article>
  ),

  file: ({ p }) => {
    const line = Number.isFinite(p.line) ? `:${p.line}` : '';
    const text = opt(p.text);
    return <Item startContent={<FileIcon size={14} />} label={text ?? `${p.path}${line}`} description={text != null ? `${p.path}${line}` : undefined} density="compact" />;
  },

  image: ({ p }) => {
    const asset = String(p.asset);
    if (!ASSET.test(asset)) return bad('image', p, 'asset must be asset:<id>');
    return (
      <figure className="ou-pb-image">
        <Plain f={{ name: `image ${asset}`, why: 'asset store not built yet', text: String(p.alt) }} />
        {p.caption != null ? <Text color="secondary" size="sm">{String(p.caption)}</Text> : null}
      </figure>
    );
  },

  sources: ({ p }) => (
    <ol className="ou-pb-sources">
      {p.items.slice(0, 50).map((s, i) => {
        if (!isObj(s) || !isStr(s.title)) return <li key={i}>{bad('source', s)}</li>;
        const where = opt(s.path ?? s.url);
        return (
          <li key={i}>
            <Citation variant="number" number={i + 1} source={{ title: String(s.title) }} />
            <VStack gap={1}>
              <Text weight="semibold">{String(s.title)}</Text>
              {where ? <Text color="secondary" size="sm">{where}</Text> : null}
              {isStr(s.quote) ? <Blockquote>{String(s.quote)}</Blockquote> : null}
            </VStack>
          </li>
        );
      })}
    </ol>
  ),

  stat: ({ p }) => (
    <Card padding={3}>
      <VStack gap={1}>
        <Text color="secondary" size="sm">{String(p.label)}</Text>
        <Heading level={2}>{String(p.value)}</Heading>
        {p.delta != null ? <Text size="sm" className={`ou-pb-dir-${p.dir || 'flat'}`}>{`${one(DIR, p.dir, '')} ${p.delta}`.trim()}</Text> : null}
        {p.sub != null ? <Text color="secondary" size="sm">{String(p.sub)}</Text> : null}
      </VStack>
    </Card>
  ),

  spinner: ({ p }) => (
    <HStack gap={2} vAlign="center">
      <Spinner size="sm" />
      <Text>{String(p.text)}</Text>
    </HStack>
  ),
};
