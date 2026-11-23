import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { MAX_ROWS } from './check.js';
import './parts-f.css';

const isStr = (v) => typeof v === 'string' || typeof v === 'number';
const need = (v) => { if (!isStr(v)) throw new Error('bad'); return String(v); };
const maybe = (v) => (v == null ? undefined : need(v));

// An agent-drawn gate is never a real gate: no action, no hash, no needs-you colour (ouros-spec section 7).
function Gate({ p }) {
  const title = maybe(p.title);
  const aside = maybe(p.aside);
  return (
    <Card padding={3} className="ou-pf-gate" role="note">
      <Text color="secondary" size="sm">The agent asks you · not a gate</Text>
      {title ? <Text type="label">{title}</Text> : null}
      <Text>{need(p.text)}</Text>
      <Text color="secondary" size="sm">{need(p.why)}</Text>
      {aside ? <Text color="secondary" size="sm">{aside}</Text> : null}
    </Card>
  );
}

const STATE = { working: { label: 'Working', variant: 'accent' }, needs: { label: 'Asks you', variant: 'neutral' }, done: { label: 'Done', variant: 'success' } };

function Tile({ p }) {
  const st = Object.hasOwn(STATE, p.state) ? STATE[p.state] : STATE.working;
  const lines = (Array.isArray(p.lines) ? p.lines : []).slice(0, MAX_ROWS).map(need);
  const branch = maybe(p.branch);
  const foot = maybe(p.foot);
  return (
    <Card padding={0} className="ou-pf-tile">
      <div className="ou-pf-tilehead">
        <Text type="label">{need(p.engine)}</Text>
        <Text className="ou-pf-task">{need(p.task)}</Text>
        <Badge variant={st.variant} label={st.label} />
      </div>
      <pre className="ou-pf-lines">{lines.join('\n')}</pre>
      {branch || p.add != null || p.del != null || foot ? (
        <div className="ou-pf-tilefoot">
          {branch ? <Text size="sm" color="secondary">{branch}</Text> : null}
          {p.add != null ? <Text size="sm" className="ou-pf-add">{need(p.add)}</Text> : null}
          {p.del != null ? <Text size="sm" className="ou-pf-del">{need(p.del)}</Text> : null}
          {foot ? <Text size="sm" color="secondary">{foot}</Text> : null}
        </div>
      ) : null}
    </Card>
  );
}

export default { gate: Gate, tile: Tile };
