import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isolation, sleep, until } from './helpers.ts';

const iso = isolation();
Object.assign(process.env, iso.env);
process.env.METATROOPER_FAKE_DPAPI = '1';
const { maskTokens, notifyText, looksLikeCredential, redactCredentials, TOKEN_RULES } = await import('../src/redact.ts');
const { appendLog } = await import('../src/log.ts');
const { logsDir } = await import('../src/paths.ts');
const term = await import('../src/terminal/index.ts');
const termEvents = await import('../src/terminal/events.ts');
const { openCoreDb } = await import('../src/store/db.ts');

after(async () => {
  term.killAll();
  await sleep(100);
  rmSync(iso.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// Deterministic pseudo-random characters, so the tokens look random but a failure reproduces.
let seed = 0x9e3779b9;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const pick = (n: number, alphabet = ALNUM) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
const B64URL = ALNUM + '-_';
const HEX = '0123456789abcdef';
const UPNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Every prefix is concatenated so no scanner sees a literal token shape in this file.
const TOKENS: Array<{ rule: string; token: string }> = [
  { rule: 'github', token: 'gh' + 'p_' + pick(36) },
  { rule: 'github-pat', token: 'github' + '_pat_' + pick(40, ALNUM + '_') },
  { rule: 'anthropic', token: 'sk' + '-ant-' + pick(40, B64URL) },
  { rule: 'openai-project', token: 'sk' + '-proj-' + pick(48, B64URL) },
  { rule: 'openai', token: 'sk' + '-' + pick(40) },
  { rule: 'aws', token: 'AK' + 'IA' + pick(16, UPNUM) },
  { rule: 'slack', token: 'xo' + 'xb-' + pick(12, '0123456789') + '-' + pick(24) },
  { rule: 'google-api', token: 'AI' + 'za' + pick(35, B64URL) },
  { rule: 'jwt', token: 'ey' + 'J' + pick(20, B64URL) + '.' + 'ey' + 'J' + pick(24, B64URL) + '.' + pick(30, B64URL) },
  { rule: 'private-key', token: '-----BEGIN ' + 'RSA PRIV' + 'ATE KEY-----' },
  { rule: 'stripe', token: 'sk' + '_live_' + pick(28) },
  { rule: 'stripe', token: 'rk' + '_live_' + pick(28) },
  { rule: 'gitlab', token: 'gl' + 'pat-' + pick(24, B64URL) },
  { rule: 'npm', token: 'np' + 'm_' + pick(36) },
  { rule: 'pypi', token: 'py' + 'pi-' + pick(64, B64URL) },
  { rule: 'huggingface', token: 'h' + 'f_' + pick(34) },
  { rule: 'google-oauth', token: 'ya' + '29.' + pick(40, B64URL) },
  { rule: 'azure-storage', token: 'Account' + 'Key=' + pick(42, ALNUM + '+/') + '==' },
  { rule: 'sendgrid', token: 'S' + 'G.' + pick(22, B64URL) + '.' + pick(43, B64URL) },
  { rule: 'bearer', token: 'Bea' + 'rer ' + pick(40, ALNUM + '._~+/=-') },
];

const SENTENCES = [
  (t: string) => `the deploy script exported ${t} and then carried on`,
  (t: string) => `error: request failed with header ${t}, retrying in 5s`,
  (t: string) => `paste this into .env: KEY=${t}`,
];

const harmless = (): string[] => {
  const out: string[] = [];
  const words = ['risk-free', 'ask-me', 'task-force', 'disk-usage', 'desk-check', 'whisk-it', 'mask-off'];
  for (let i = 0; i < 200; i++) {
    const sha = pick(40, HEX);
    const uuid = `${pick(8, HEX)}-${pick(4, HEX)}-${pick(4, HEX)}-${pick(4, HEX)}-${pick(12, HEX)}`;
    const seg = Buffer.from(pick(30)).toString('base64').replace(/=+$/, '');
    switch (i % 8) {
      case 0: out.push(`commit ${sha} Merge branch 'main' into feature-${i}`); break;
      case 1: out.push(`session ${uuid} state changed to working`); break;
      case 2: out.push(`opened C:\\Users\\someone\\AppData\\Local\\Temp\\metatrooper-${pick(8)}\\logs\\core.log`); break;
      case 3: out.push(`reading /home/someone/projects/app/node_modules/.cache/${seg}/index.json`); break;
      case 4: out.push(`${words[i % words.length]} is fine, ${words[(i + 3) % words.length]} too; ordinary log text line ${i}`); break;
      case 5: out.push(`GET /api/v1/items?page=${i} 200 ${i * 3}ms ${sha.slice(0, 12)}`); break;
      case 6: out.push(`C:/Users/someone/work/${seg}/${seg}/build.log:${i}: warning: unused variable`); break;
      default: out.push(`checkout ${sha} and ${sha.slice(0, 7)} for ${uuid.slice(0, 13)}`);
    }
  }
  return out;
};

const pad200 = (s: string) => (s + ' ' + 'lorem ipsum dolor sit amet '.repeat(10)).slice(0, 200);

// protects=every known token shape in TOKEN_RULES is masked; fails_when=a rule is missing, mistyped, or its entropy floor drops a real token; no_claim=unknown token shapes, or that the corpus tokens are live credentials.
test('M7-05a: 20 of 20 real-shaped tokens are masked, at most 2 of 200 harmless lines change', () => {
  assert.equal(TOKENS.length, 20);
  const ruleIds = new Set(TOKENS.map((t) => t.rule));
  for (const rule of TOKEN_RULES) assert.ok(ruleIds.has(rule.id), `no corpus token for rule ${rule.id}`);
  let masked = 0;
  TOKENS.forEach(({ rule, token }, i) => {
    const out = maskTokens(SENTENCES[i % SENTENCES.length](token));
    if (out.includes('[token]') && !out.includes(token)) masked++;
    else assert.fail(`rule ${rule} did not mask its token: ${out}`);
  });
  assert.equal(masked, 20);

  const lines = harmless();
  assert.equal(lines.length, 200);
  const changed = lines.filter((l) => maskTokens(l) !== l);
  assert.ok(changed.length <= 2, `changed ${changed.length}: ${changed.slice(0, 3).join(' | ')}`);
});

// protects=masking stays cheap enough to run on every log line and title; fails_when=a rule loses its keyword prefilter or a regex backtracks; no_claim=speed on other machines or on lines far over 200 characters.
test('M7-05a: mean time per 200-character line is under 50 microseconds', () => {
  const lines = [...harmless(), ...TOKENS.map(({ token }, i) => SENTENCES[i % 3](token))].map(pad200);
  assert.ok(lines.every((l) => l.length === 200));
  let sink = 0;
  for (let r = 0; r < 20; r++) for (const l of lines) sink += maskTokens(l).length;
  const RUNS = 200;
  const start = process.hrtime.bigint();
  for (let r = 0; r < RUNS; r++) for (const l of lines) sink += maskTokens(l).length;
  const meanUs = Number(process.hrtime.bigint() - start) / 1000 / (RUNS * lines.length);
  assert.ok(sink > 0);
  assert.ok(meanUs < 50, `mean ${meanUs.toFixed(2)} us per line`);
});

const SAMPLE = TOKENS[0].token;

// protects=a token reaching the core log is stored masked; fails_when=appendLog stops calling maskTokens; no_claim=rotation or secret-value redaction (M5-04).
test('M7-05g: appendLog writes the token as [token]', () => {
  mkdirSync(logsDir(), { recursive: true });
  appendLog('m7-05g', `token seen: ${SAMPLE} end\n`);
  const log = readFileSync(join(logsDir(), 'm7-05g.log'), 'utf8');
  assert.match(log, /token seen: \[token\] end/);
  assert.ok(!log.includes(SAMPLE));
});

// protects=notification sinks get [token], not the token; fails_when=notifyText stops masking first (redactCredentials would then write [secret] or <redacted>); no_claim=URL and path stripping.
test('M7-05g: notifyText shows the token as [token]', () => {
  for (const { token } of TOKENS) {
    const out = notifyText('gate', `needs approval for ${token} now`);
    assert.ok(out.includes('[token]'), out);
    assert.ok(!out.includes(token), out);
  }
});

// protects=a token printed or set as window title in a real pty is masked in the stored title and last line while the pty stream keeps it; fails_when=events.ts skips maskTokens on title or line, or masking is applied to the raw stream; no_claim=other platforms' pty behaviour or title mangling by the host terminal.
test('M7-05g: stored title and last line show [token]; the raw pty stream still holds the token', async () => {
  const token = TOKENS.find((t) => t.rule === 'openai')!.token; // sk- shape, plain alphanumerics survive any title handling
  const db = openCoreDb();
  const id = `m705-${Date.now()}`;
  termEvents.wireTermEvents(db);
  const code = `process.stdout.write('\\x1b]0;title ' + ${JSON.stringify(token)} + '\\x1b\\\\');process.stdout.write('printed ' + ${JSON.stringify(token)} + '\\r\\n');setInterval(()=>{},1000)`;
  term.open(id, [process.execPath, '-e', code], iso.home, process.env);
  try {
    await until(async () => (await term.snapshot(id))?.includes(token), 8000);
    const raw = (await term.snapshot(id)) ?? '';
    assert.ok(raw.includes(token), 'raw pty stream keeps the token');
    await until(() => termEvents.liveText()[id]?.title && termEvents.liveText()[id]?.line, 8000).catch(() => {});
    const live = termEvents.liveText()[id];
    assert.ok(live?.title?.includes('[token]'), `title: ${live?.title}`);
    assert.ok(!live?.title?.includes(token));
    assert.ok(live?.line?.includes('[token]'), `line: ${live?.line}`);
    assert.ok(!live?.line?.includes(token));
  } finally {
    term.kill(id);
    await until(() => !term.has(id));
    db.close();
  }
});

// The old 8 CREDENTIAL_PATTERNS, copied literally from a8a3b642:core/src/redact.ts.
const OLD_PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_\w{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

// protects=approvals still ask on every string the old 8 patterns flagged; fails_when=the TOKEN_RULES-derived CREDENTIAL_PATTERNS lose a shape the old list had; no_claim=the long-run and entropy checks, or the M6-2 approval suite itself.
test('M7-05h: every string the old credential patterns flagged still flags and redacts', () => {
  const samples = [
    'gh' + 'p_' + pick(36), 'gh' + 'o_' + pick(36), 'gh' + 'u_' + pick(36), 'gh' + 's_' + pick(36), 'gh' + 'r_' + pick(36),
    'github' + '_pat_' + pick(30),
    'sk' + '-' + pick(30, B64URL), 'sk' + '-ant-' + pick(30, B64URL), 'sk' + '-proj-' + pick(30, B64URL),
    'AK' + 'IA' + pick(16, UPNUM),
    ...['a', 'b', 'p', 'r', 's'].map((c) => 'xo' + 'x' + c + '-' + pick(14)),
    'AI' + 'za' + pick(35, B64URL),
    'ey' + 'J' + pick(12, B64URL) + '.' + pick(12, B64URL) + '.' + pick(10, B64URL),
    'ey' + 'J' + pick(12, B64URL) + '.' + pick(12, B64URL) + '.',
    '-----BEGIN ' + 'PRIVATE KEY-----', '-----BEGIN ' + 'RSA PRIVATE KEY-----', '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----',
  ];
  const covered = new Set<number>();
  for (const s of samples) {
    const hit = OLD_PATTERNS.findIndex((re) => re.test(s));
    assert.ok(hit >= 0, `sample is not an old-pattern string: ${s}`);
    covered.add(hit);
    assert.equal(looksLikeCredential(s), true, `looksLikeCredential lost: ${s}`);
    const out = redactCredentials(`before ${s} after`);
    assert.ok(out.includes('[secret]'), out);
    assert.ok(!out.includes(s), out);
  }
  assert.equal(covered.size, OLD_PATTERNS.length, 'a sample for each old pattern');
});
