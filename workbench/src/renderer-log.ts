export function rendererLogger(limit = 50, now = Date.now) {
  let start: number | undefined;
  let written = 0;
  let dropped = 0;
  return (details: { level: unknown; message?: string; sourceId?: string; lineNumber?: number }): string[] => {
    const level = details.level === 2 ? 'warning' : details.level === 3 ? 'error' : details.level;
    if (level !== 'warning' && level !== 'error') return [];
    const time = now();
    const lines: string[] = [];
    if (start === undefined || time - start >= 60_000) {
      if (dropped) lines.push(`renderer: ${dropped} lines dropped over the cap in the last minute`);
      start = time;
      written = dropped = 0;
    }
    if (written >= limit) { dropped++; return []; }
    written++;
    const source = (details.sourceId ?? '?').split(/[\\/]/).pop();
    const message = (details.message ?? '').split(/[\r\n]/, 1)[0].slice(0, 200);
    lines.push(`renderer ${level} ${source}:${details.lineNumber ?? 0} ${message}`);
    return lines;
  };
}
