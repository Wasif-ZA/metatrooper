function diffLines(text) {
  const out = [];
  let oldN = 0, newN = 0, oldLeft = 0, newLeft = 0;
  for (const raw of text.split('\n')) {
    const m = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      oldN = Number(m[1]); newN = Number(m[3]);
      oldLeft = m[2] === undefined ? 1 : Number(m[2]); newLeft = m[4] === undefined ? 1 : Number(m[4]);
      out.push({ kind: 'hunk', text: raw }); continue;
    }
    if (!oldLeft && !newLeft) continue;
    if (raw.startsWith('+')) { out.push({ kind: 'add', line: newN++, text: raw }); newLeft--; }
    else if (raw.startsWith('-')) { out.push({ kind: 'del', line: oldN++, text: raw }); oldLeft--; }
    else if (raw.startsWith(' ')) { out.push({ kind: 'ctx', line: newN++, text: raw }); oldN++; oldLeft--; newLeft--; }
  }
  return out;
}
