const SEVERITIES = ['critical', 'high', 'medium', 'low'];

/** Fails the run unless findings.json exists, is an array, and every finding has a severity, title and detail. */
export async function run(ctx) {
  const list = JSON.parse(await ctx.readFile('findings.json'));
  if (!Array.isArray(list)) throw new Error('findings.json is not a JSON array');
  list.forEach((f, i) => {
    const bad = !f || !SEVERITIES.includes(f.severity) || !String(f.title ?? '').trim() || !String(f.detail ?? '').trim();
    if (bad) throw new Error(`findings.json item ${i} needs a severity (${SEVERITIES.join(', ')}), a title and a detail`);
  });
  return { count: list.length };
}
