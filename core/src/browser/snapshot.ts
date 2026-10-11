import { tokenCount } from '../meter.ts';

export const ACTIONABLE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'slider', 'switch', 'listbox', 'spinbutton', 'treeitem']);

export interface AXNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  ignored?: boolean;
  backendDOMNodeId?: number;
}

/** One frame's accessibility tree; `owner` is the backend node id of its iframe element in `parent`. */
export interface Frame {
  id: string;
  nodes: AXNode[];
  parent?: string;
  owner?: number;
}

export interface Target {
  frameId: string;
  backendNodeId: number;
}

/** A pane's refs: `e12` in the main frame, `f2e12` in a child frame, never reused while the pane is open. */
export interface Refs {
  byKey: Map<string, string>;
  byRef: Map<string, Target>;
  tags: Map<string, string>;
  next: number;
  frames: number;
}

export function newRefs(): Refs {
  return { byKey: new Map(), byRef: new Map(), tags: new Map(), next: 0, frames: 0 };
}

function refFor(refs: Refs, frameId: string, backendNodeId: number, main: boolean): string {
  const key = `${frameId}:${backendNodeId}`;
  const hit = refs.byKey.get(key);
  if (hit) return hit;
  let tag = '';
  if (!main) {
    tag = refs.tags.get(frameId) ?? `f${++refs.frames}`;
    refs.tags.set(frameId, tag);
  }
  const ref = `${tag}e${++refs.next}`;
  refs.byKey.set(key, ref);
  refs.byRef.set(ref, { frameId, backendNodeId });
  return ref;
}

/** Ends every ref in one frame, as when that frame navigates. */
export function dropFrame(refs: Refs, frameId: string): void {
  for (const [ref, t] of refs.byRef) {
    if (t.frameId !== frameId) continue;
    refs.byRef.delete(ref);
    refs.byKey.delete(`${frameId}:${t.backendNodeId}`);
  }
}

/** The element behind a ref; 'gone' for a ref this pane handed out whose frame has since navigated. */
export function resolveRef(refs: Refs, ref: unknown): Target | 'gone' | 'unknown' {
  if (typeof ref !== 'string') return 'unknown';
  const t = refs.byRef.get(ref);
  if (t) return t;
  const m = /^(?:f\d+)?e(\d+)$/.exec(ref);
  return m && Number(m[1]) <= refs.next ? 'gone' : 'unknown';
}

/** Accessibility lines for every frame, child frames nested under their iframe; null when `scope` is not in the tree. */
export function render(frames: Frame[], refs: Refs, scope?: Target): string[] | null {
  const main = frames[0]?.id;
  const children = new Map<string, Frame>();
  for (const f of frames) if (f.parent && f.owner) children.set(`${f.parent}:${f.owner}`, f);
  const lines: string[] = [];
  const seen = new Set<string>();
  const walkFrame = (frame: Frame, start: AXNode | undefined, depth: number) => {
    seen.add(frame.id);
    const byId = new Map(frame.nodes.map((n) => [n.nodeId, n]));
    const walk = (n: AXNode | undefined, d: number) => {
      if (!n) return;
      const role = String(n.role?.value ?? '');
      const name = String(n.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const skip = n.ignored || role === 'none' || role === 'generic' || (role === 'StaticText' && !name) || role === 'InlineTextBox';
      let next = d;
      if (!skip) {
        let line = `${'  '.repeat(d)}${role}${name ? ` "${name}"` : ''}`;
        if (ACTIONABLE.has(role) && n.backendDOMNodeId) {
          line += ` [ref=${refFor(refs, frame.id, n.backendDOMNodeId, frame.id === main)}]`;
          const value = n.value?.value;
          if (value !== undefined && value !== '') line += ` value="${String(value).slice(0, 80)}"`;
        }
        lines.push(line);
        next = d + 1;
      }
      for (const c of n.childIds ?? []) walk(byId.get(c), next);
      const child = n.backendDOMNodeId ? children.get(`${frame.id}:${n.backendDOMNodeId}`) : undefined;
      if (child && !seen.has(child.id)) walkFrame(child, undefined, next);
    };
    walk(start ?? frame.nodes.find((n) => !n.parentId) ?? frame.nodes[0], depth);
  };
  if (scope) {
    const frame = frames.find((f) => f.id === scope.frameId);
    const node = frame?.nodes.find((n) => n.backendDOMNodeId === scope.backendNodeId);
    if (!frame || !node) return null;
    walkFrame(frame, node, 0);
    return lines;
  }
  if (frames[0]) walkFrame(frames[0], undefined, 0);
  for (const f of frames) if (!seen.has(f.id) && f.nodes.length) walkFrame(f, undefined, 0);
  return lines;
}

/** Only lines carrying a ref, plus the ancestors above them. */
export function interactiveOnly(lines: string[]): string[] {
  const out: string[] = [];
  const stack: Array<{ depth: number; line: string; shown: boolean }> = [];
  for (const line of lines) {
    const depth = (line.length - line.trimStart().length) / 2;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const entry = { depth, line, shown: false };
    if (line.includes(' [ref=')) {
      for (const s of stack) if (!s.shown) { out.push(s.line); s.shown = true; }
      out.push(line);
      entry.shown = true;
    }
    stack.push(entry);
  }
  return out;
}

/** Lines added since `prev` as `+ line`, then lines gone since `prev` as `- line`. */
export function diffLines(prev: string[], cur: string[]): string[] {
  const left = new Map<string, number>();
  for (const l of prev) left.set(l, (left.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of cur) {
    const n = left.get(l) ?? 0;
    if (n > 0) left.set(l, n - 1);
    else added.push(`+ ${l}`);
  }
  const removed: string[] = [];
  for (const l of prev) {
    const n = left.get(l) ?? 0;
    if (n > 0) { removed.push(`- ${l}`); left.set(l, n - 1); }
  }
  return [...added, ...removed];
}

/** The leading lines that fit in `maxTokens` with room for `trailer`, and the lines left over. */
export function fit(lines: string[], maxTokens: number, trailer: string): { head: string[]; rest: string[] } {
  if (tokenCount(lines.join('\n')) <= maxTokens) return { head: lines, rest: [] };
  let used = tokenCount(`\n${trailer}`);
  let i = 0;
  for (; i < lines.length; i++) {
    const t = tokenCount(`${lines[i]}\n`);
    if (used + t > maxTokens) break;
    used += t;
  }
  if (i === 0) return { head: [lines[0].slice(0, Math.max(0, (maxTokens - used - 1) * 3))], rest: lines.slice(1) };
  return { head: lines.slice(0, i), rest: lines.slice(i) };
}
