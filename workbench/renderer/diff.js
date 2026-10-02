function diffLines(text) {
  const out = [];
  let oldN = 0, newN = 0;
  for (const raw of text.split('\n')) {
    const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { oldN = Number(m[1]); newN = Number(m[2]); out.push({ kind: 'hunk', text: raw }); continue; }
    if (!oldN && !newN) continue;
    if (raw.startsWith('+')) out.push({ kind: 'add', line: newN++, text: raw });
    else if (raw.startsWith('-')) out.push({ kind: 'del', line: oldN++, text: raw });
    else if (raw.startsWith(' ')) { out.push({ kind: 'ctx', line: newN++, text: raw }); oldN++; }
  }
  return out;
}
