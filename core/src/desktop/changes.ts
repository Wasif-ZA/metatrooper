export type TreeNodes = Array<[string, string]>;

// Added, removed and re-valued nodes between two helper tree reads, each list cut to cap.
export function treeChanges(before: TreeNodes, after: TreeNodes, cap = 20): { added: string[]; removed: string[]; changed: Array<{ from: string; to: string }>; truncated?: true } {
  const keyed = (nodes: TreeNodes) => {
    const seen = new Map<string, number>();
    return new Map(nodes.map(([rid, line]) => {
      const base = rid || 'line:' + line;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return [rid ? base : base + '#' + n, line] as [string, string];
    }));
  };
  const b = keyed(before);
  const a = keyed(after);
  const added = [...a].filter(([k]) => !b.has(k)).map(([, l]) => l);
  const removed = [...b].filter(([k]) => !a.has(k)).map(([, l]) => l);
  const changed = [...a].filter(([k, l]) => b.has(k) && b.get(k) !== l).map(([k, l]) => ({ from: b.get(k)!, to: l }));
  const truncated = added.length > cap || removed.length > cap || changed.length > cap;
  const out = { added: added.slice(0, cap), removed: removed.slice(0, cap), changed: changed.slice(0, cap) };
  return truncated ? { ...out, truncated: true } : out;
}
