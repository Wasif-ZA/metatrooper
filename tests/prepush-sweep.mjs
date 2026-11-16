const OUTSIDE_PRODUCTS = [
  't3code', 't3 code', 'Paperclip', 'herdr', 'conductor.build',
];
const CAPITALISED_PRODUCTS = ['Conductor', 'Cursor', 'Warp', 'Zed', 'Superset'];
const ACU_TERMS = ['work/ACU', 'hwbreports', 'agg-hwbreports', 'ACU', 'Australian Catholic'];

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const CHECKS = ['commit-text', 'secrets', 'personal-paths', 'big-files', 'junk-folders', 'fast-forward'];
const LIMIT = 5 * 1024 * 1024;
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]*/g,
  /xox[baprs]-[A-Za-z0-9-]*/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]*/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /polar_[A-Za-z0-9_]{20,}/g,
  /\b(?:password|secret|token|api_key)["']?\s*[:=]\s*["']([^"'\r\n]{12,})["']/gi,
];
const ALLOWED_USERS = new Set(['you', 'user', '<user>', 'runneradmin', 'public', 'default']);
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' };
const gitPrefix = ['--no-pager', '-c', 'core.quotePath=false', '-c', 'color.ui=false'];

function secretSpans(text) {
  const spans = [];
  for (const pattern of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      const start = match.index + (match[1] === undefined ? 0 : match[0].indexOf(value));
      spans.push({ start, end: start + value.length, value, generic: match[1] !== undefined });
    }
  }
  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

function maskSecrets(text) {
  let output = '';
  let offset = 0;
  for (const span of secretSpans(text)) {
    if (span.start < offset) continue;
    output += text.slice(offset, span.start) + span.value.slice(0, 4) + '[REDACTED]';
    offset = span.end;
  }
  return output + text.slice(offset);
}

function git(args, { input, allowOne = false } = {}) {
  const result = spawnSync('git', [...gitPrefix, ...args], {
    encoding: 'utf8', env: gitEnv, input, maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || (result.status !== 0 && !(allowOne && result.status === 1))) {
    throw new Error(`git ${args[0]}: ${result.error?.message ?? result.stderr.trim() ?? 'failed'}`);
  }
  return result;
}

async function patchLines(range, visit) {
  const child = spawn('git', [...gitPrefix, 'log', '--no-show-signature', '--no-notes', '-p', '-m', '--format=%x1e%H',
    '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', range, '--'], { env: gitEnv });
  let stderr = '';
  const completion = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`git log: ${stderr.trim()}`)));
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) visit(line);
  await completion;
}

function parseArgs(args) {
  const options = { base: 'origin/main', head: 'HEAD', json: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!['--base', '--head', '--json'].includes(arg) || seen.has(arg)) {
      throw new Error(`Usage: node tests/prepush-sweep.mjs [--base origin/main] [--head HEAD] [--json] (invalid option ${arg})`);
    }
    seen.add(arg);
    if (arg === '--json') options.json = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new Error(`Missing revision for ${arg}`);
      options[arg.slice(2)] = value;
    }
  }
  return options;
}

function wordPattern(term, flags = 'gi') {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, flags);
}

function junkPath(path) {
  return /^dist(?:\/|$)|(?:^|\/)(?:Microsoft|node_modules|\.cache)(?:\/|$)|(?:^|\/)[^/]*\.log$|(?:^|\/)(?:Thumbs\.db|desktop\.ini)$/i.test(path);
}

function loadAllowlist() {
  const entries = JSON.parse(readFileSync(new URL('./prepush-sweep-allow.json', import.meta.url), 'utf8'));
  if (!Array.isArray(entries) || entries.some(entry => !entry || !CHECKS.includes(entry.check)
    || typeof entry.path !== 'string' || !entry.path || typeof entry.reason !== 'string' || !entry.reason.trim()
    || Object.keys(entry).some(key => !['check', 'path', 'reason'].includes(key)))) {
    throw new Error('Invalid tests/prepush-sweep-allow.json: expected an array of { check, path, reason }');
  }
  return entries;
}

function decodePath(path) {
  if (!path.startsWith('"')) return path;
  try { return JSON.parse(path); } catch { return path; }
}

async function sweep(options) {
  const allowlist = loadAllowlist();
  const base = git(['rev-parse', '--verify', '--end-of-options', `${options.base}^{commit}`]).stdout.trim();
  const head = git(['rev-parse', '--verify', '--end-of-options', `${options.head}^{commit}`]).stdout.trim();
  const range = `${base}..${head}`;
  const findings = [];
  const seen = new Map();
  const commitOrder = new Map();
  function add(check, location, text, severity = 'fail', generic = false) {
    const maskedText = maskSecrets(text);
    const key = JSON.stringify([check, location.file ?? '', maskedText]);
    // This generated bundle may exempt generic assignments only. Recognisable
    // token formats must still fail even if an allowlist glob matches it.
    const entry = check === 'secrets' && location.file === 'workbench/renderer/ui.bundle.js' && !generic
      ? undefined : allowlist.find(entry => entry.check === check && location.file
        && posix.matchesGlob(location.file, entry.path));
    const effectiveSeverity = entry ? 'allowed' : severity;
    let record = seen.get(key);
    if (!record) {
      const finding = { check, severity: effectiveSeverity,
        ...(location.file ? { file: maskSecrets(location.file) } : {}), text: maskedText, commitCount: 0 };
      if (entry) finding.reason = maskSecrets(entry.reason);
      record = { finding, commits: new Set(), newest: Infinity };
      seen.set(key, record);
      findings.push(finding);
    } else if (effectiveSeverity === 'fail' || (effectiveSeverity === 'warn' && record.finding.severity === 'allowed')) {
      record.finding.severity = effectiveSeverity;
      delete record.finding.reason;
    }
    if (location.commit) {
      record.commits.add(location.commit);
      record.finding.commitCount = record.commits.size;
      const order = commitOrder.get(location.commit) ?? Infinity;
      if (!record.finding.commit || order < record.newest) {
        record.finding.commit = location.commit.slice(0, 8);
        record.newest = order;
      }
    }
  }

  const fields = git(['log', '--no-show-signature', '--no-notes', '-z', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B', range, '--']).stdout.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const commits = [];
  const terms = [...[...OUTSIDE_PRODUCTS, ...ACU_TERMS].map(term => wordPattern(term)),
    ...CAPITALISED_PRODUCTS.map(term => wordPattern(term, 'g'))];
  for (let index = 0; index < fields.length; index += 6) {
    const sha = fields[index];
    commits.push(sha);
    commitOrder.set(sha, index / 6);
    for (const field of fields.slice(index + 1, index + 6)) {
      for (const pattern of terms) {
        for (const match of field.matchAll(pattern)) add('commit-text', { commit: sha }, match[0]);
      }
    }
  }

  let commit = '';
  let file = '';
  let inHunk = false;
  await patchLines(range, line => {
    if (/^\x1e[0-9a-f]+$/.test(line)) {
      commit = line.slice(1);
      inHunk = false;
    } else if (line.startsWith('diff --git ')) {
      inHunk = false;
      file = '';
    } else if (!inHunk && line.startsWith('+++ ')) {
      file = decodePath(line.slice(4)).replace(/^b\//, '');
    } else if (line.startsWith('@@ ')) {
      inHunk = true;
    } else if (inHunk && line.startsWith('+')) {
      const text = line.slice(1);
      const location = { commit, file };
      for (const span of secretSpans(text)) add('secrets', location, span.value.slice(0, 4) + '[REDACTED]', 'fail', span.generic);
      for (const match of text.matchAll(/(?:\bC:[\\/]Users[\\/]|\/home\/)([^\\/\r\n]+)[\\/]/gi)) {
        if (!ALLOWED_USERS.has(match[1].toLowerCase())) add('personal-paths', location, match[0]);
      }
      for (const match of text.matchAll(/\.cache\/claude-scratch|teehee/gi)) add('personal-paths', location, match[0]);
    }
  });

  const blobs = new Map();
  const blobLocation = (oid, location) => {
    if (!blobs.has(oid)) blobs.set(oid, new Map());
    blobs.get(oid).set(JSON.stringify(location), location);
  };
  for (const sha of commits) {
    const entries = git(['diff-tree', '-m', '--root', '--no-commit-id', '--raw', '-r', '-z', '--no-renames', sha, '--']).stdout.split('\0');
    for (let index = 0; index < entries.length - 1; index += 2) {
      const metadata = entries[index].split(' ');
      const path = entries[index + 1];
      const location = { commit: sha, file: path };
      if (junkPath(path)) add('junk-folders', location, path);
      if (metadata[4] !== 'D' && metadata[1] !== '160000') blobLocation(metadata[3], location);
    }
  }

  const headFiles = git(['diff', '--name-only', '-z', '--no-ext-diff', '--no-renames', base, head, '--']).stdout.split('\0').filter(Boolean);
  for (const path of headFiles) {
    const tree = git(['ls-tree', '-z', head, '--', `:(literal)${path}`]).stdout;
    const match = /^\d+ blob ([0-9a-f]+)\t/.exec(tree);
    if (match) {
      blobLocation(match[1], { file: path });
    }
  }
  const objects = git(['rev-list', '--objects', range, '--']).stdout.trim();
  for (const line of objects ? objects.split('\n') : []) {
    const space = line.indexOf(' ');
    const oid = space === -1 ? line : line.slice(0, space);
    blobLocation(oid, { file: space === -1 ? oid : decodePath(line.slice(space + 1)) });
  }
  if (blobs.size) {
    const sizes = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
      input: [...blobs.keys()].join('\n') + '\n',
    }).stdout.trim().split('\n');
    for (const line of sizes) {
      const [oid, type, size] = line.split(' ');
      if (type === 'missing') throw new Error(`git cat-file: missing object ${oid}`);
      if (type === 'blob' && Number(size) > LIMIT) {
        for (const location of blobs.get(oid).values()) add('big-files', location, `${size} bytes (over 5 MB)`);
      }
    }
  }

  const status = git(['status', '--porcelain', '-z', '--untracked-files=all']).stdout.split('\0');
  for (let index = 0; index < status.length; index++) {
    const entry = status[index];
    if (entry.startsWith('?? ') && junkPath(entry.slice(3))) {
      add('junk-folders', { file: entry.slice(3) }, 'untracked, keep out of the commit', 'warn');
    }
    if (/^[RC]|^.[RC]/.test(entry)) index++;
  }
  if (git(['merge-base', '--is-ancestor', base, head], { allowOne: true }).status === 1) {
    add('fast-forward', { commit: head }, 'push would not be fast-forward; never force-push');
  }
  const counts = Object.fromEntries(CHECKS.map(check => [check, findings.filter(finding => finding.check === check).length]));
  const failures = findings.filter(finding => finding.severity === 'fail').length;
  const warnings = findings.filter(finding => finding.severity === 'warn').length;
  const allowed = findings.filter(finding => finding.severity === 'allowed').length;
  const groupedCounts = Object.fromEntries(CHECKS.map(check => [check, Object.fromEntries(
    ['fail', 'warn', 'allowed'].map(severity => [severity, findings.filter(f => f.check === check && f.severity === severity).length]),
  )]));
  const summary = `${commits.length} commits scanned; ${failures} fail, ${warnings} warn, ${allowed} allowed`;
  return { base, head, commitsScanned: commits.length, findings, counts, groupedCounts, failures, warnings, allowed, summary, exitCode: failures ? 1 : 0 };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = await sweep(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const finding of report.findings) {
      const location = [finding.commit, finding.file].filter(Boolean).map(value => JSON.stringify(value)).join(' ');
      console.log(`${finding.severity} ${finding.check} ${location}: ${JSON.stringify(finding.text)} (${finding.commitCount} commits)${finding.reason ? `; reason: ${JSON.stringify(finding.reason)}` : ''}`);
    }
    console.log(report.summary);
    console.log('check           fail  warn  allowed');
    for (const [check, counts] of Object.entries(report.groupedCounts)) {
      console.log(`${check.padEnd(15)} ${String(counts.fail).padStart(4)}  ${String(counts.warn).padStart(4)}  ${String(counts.allowed).padStart(7)}`);
    }
  }
  process.exitCode = report.exitCode;
} catch (error) {
  const message = maskSecrets(error.message);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ error: message, exitCode: 2 }));
  else console.error(message);
  process.exitCode = 2;
}
