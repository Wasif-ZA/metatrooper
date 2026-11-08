import path from 'node:path';

export type Rule = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9';
export type Tier = 'gate' | 'decision' | 'log';
export type PolicyAction =
  | { kind: 'shell'; command: string }
  | { kind: 'edit'; path: string }
  | { kind: 'question'; text: string };
export interface PolicyContext {
  workspace: string;
  /** Hosts this project has already sent to. */
  knownHosts?: Set<string>;
  /** Regex sources for boundaries the user stated. */
  boundaries?: string[];
}
export interface Verdict { tier: Tier; rule?: Rule; why?: string }

const NET = /\b(curl|wget|scp|rsync|nc|ncat|ssh|sftp|ftp|invoke-webrequest|invoke-restmethod|iwr|irm)\b/i;
const LEAVING = /(\.env\b|id_rsa|id_ed25519|\.pem\b|\.npmrc|secrets?\b|credentials?\b|api[_-]?key|\btoken\b)/i;
const PROTECTED_BRANCH = /^(main|master|production|prod|release\S*|gh-pages)$/;
const SECRET_VAR = /\b(?:[A-Z0-9]+_)*(?:TOKEN|SECRET|PASSWORD|KEY)(?:_[A-Z0-9]+)*\b/;
const VALUE_FLAG = /^(-[odHXuAeFTmbcwKPi]|--(output|data[\w-]*|header|request|user(-agent)?|referer|form|upload-file|cookie(-jar)?|output-document|post-data))$/;
const SSH_VALUE_FLAG = /^-[pilFJLRDbcEeImOQSWws]$/;
const VAR_ASSIGN = /^[A-Za-z_]\w*=/;

const SHELL_RULES: Array<[Rule, RegExp, string]> = [
  ['A1', /\bgit\s+(reset\s+--hard|clean\s+-\S*[fd]|checkout\s+(--\s+)?\.(\s|$)|restore\s+(?!--staged)\S|stash\s+(drop|clear))/i, 'discards uncommitted work'],
  ['A2', /(\brm\s+(-\S*[rR]|--recursive)|\brmdir\s+\/s|\bdel\s+\/s|remove-item\b[^|;]*\s-r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?(?![\w-])|\b(?:rd|rmdir)\b[^|;]*\s\/s\b|\bfind\b[^|;]*\s-delete\b)/i, 'recursive delete'],
  ['A6', /(\b(npm|pnpm|yarn)\s+(publish|deploy|run\s+deploy)(?=\s|$)|\b(vercel|netlify|fly|flyctl|wrangler)\s+(deploy|--prod)|\bterraform\s+(apply|destroy)|\bkubectl\s+(apply|delete)|\bdocker\s+push|\bgh\s+release\s+create|\bcargo\s+publish|\btwine\s+upload)/i, 'deploy, publish or shared infrastructure'],
];

/** Splits a command on ; & | and newlines into quote-stripped word lists. */
function segments(cmd: string): string[][] {
  const out: string[][] = [[]];
  let w: string | null = null;
  let q = '';
  const end = () => { if (w !== null) out[out.length - 1].push(w); w = null; };
  for (const c of cmd) {
    if (q) { if (c === q) q = ''; else w += c; }
    else if (c === '"' || c === "'") { q = c; w ??= ''; }
    else if (c === ';' || c === '&' || c === '|' || c === '\n') { end(); if (out[out.length - 1].length) out.push([]); }
    else if (/\s/.test(c)) end();
    else w = (w ?? '') + c;
  }
  end();
  return out.filter((s) => s.length);
}

/** Drops env prefixes and wrapper options and reduces the executable to its bare name. */
function normalize(w: string[]): string[] {
  const base = (s: string) => s.split(/[\\/]/).pop()!.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
  let i = 0;
  for (let env = false; i < w.length; i++) {
    if (VAR_ASSIGN.test(w[i])) continue;
    if (base(w[i]) === 'env') { env = true; continue; }
    if (env && w[i].startsWith('-')) continue;
    break;
  }
  if (i >= w.length) return [];
  const exe = base(w[i]);
  let rest = w.slice(i + 1);
  if (exe === 'git') {
    for (;;) {
      const o = rest[0] ?? '';
      if (/^-[Cc]$|^--(git-dir|work-tree|namespace)$/.test(o)) rest = rest.slice(2);
      else if (/^--(git-dir|work-tree|namespace)=|^--(no-pager|bare)$/.test(o)) rest = rest.slice(1);
      else break;
    }
  } else if (/^(npm|pnpm|yarn)$/.test(exe)) while (rest[0]?.startsWith('-')) rest = rest.slice(1);
  return [exe, ...rest];
}

function pushTarget(cmd: string): string | null {
  const m = /\bgit\s+push\b(.*)/i.exec(cmd);
  if (!m) return null;
  const args = m[1].trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
  if (/\s--repo=/.test(m[1])) args.unshift('');
  const refspec = args[1] ?? '';
  return refspec.split(':').pop()!.replace(/^\+/, '').replace(/^refs\/heads\//, '') || '';
}

function hostsOf(cmd: string, words: string[][] = []): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(/\b(?:https?|ssh|ftp):\/\/(?:[^@\s/]+@)?([^/:\s'"]+)|\b[\w.-]+@([\w.-]+):/g)) out.push((m[1] ?? m[2]).toLowerCase());
  for (const [exe, ...rest] of words) {
    if (exe === 'curl' || exe === 'wget') {
      for (const [i, r] of rest.entries()) {
        const m = !r.startsWith('-') && !VALUE_FLAG.test(rest[i - 1] ?? '') && /^(?:[^@/]+@)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:\/.*)?$/i.exec(r);
        if (m) out.push(m[1].toLowerCase());
      }
    } else if (/^(ssh|sftp|nc|ncat|ftp)$/.test(exe)) {
      const h = rest.find((r, i) => !r.startsWith('-') && !SSH_VALUE_FLAG.test(rest[i - 1] ?? ''));
      if (h && !h.includes('://') && !/^\d+$/.test(h)) out.push(h.replace(/^.*@/, '').split(':')[0].toLowerCase());
    } else if (exe === 'scp' || exe === 'rsync') {
      for (const r of rest) { const m = !r.startsWith('-') && /^(?:[^@\s:]+@)?([\w.-]{2,}):(?!\/\/)/.exec(r); if (m) out.push(m[1].toLowerCase()); }
    }
  }
  return out.filter(Boolean);
}

const inside = (root: string, p: string) => {
  const rel = path.relative(path.resolve(root), path.resolve(root, p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Which tier an agent action lands in; the A-list is checked first so it gates in every mode. */
export function classify(a: PolicyAction, ctx: PolicyContext): Verdict {
  if (a.kind === 'question') return { tier: 'decision' };
  if (a.kind !== 'shell' && a.kind !== 'edit') return { tier: 'gate', why: 'unknown action kind' };
  const words = a.kind === 'shell' ? segments(a.command).map(normalize).filter((w) => w.length) : [];
  const views = a.kind === 'shell' ? [a.command, ...words.map((w) => w.join(' '))] : [a.path];
  for (const b of ctx.boundaries ?? []) {
    let re: RegExp;
    try { re = new RegExp(b, 'i'); } catch { return { tier: 'gate', rule: 'A8', why: 'invalid boundary' }; }
    if (views.some((v) => re.test(v))) return { tier: 'gate', rule: 'A8', why: `matches your boundary ${b}` };
  }
  if (a.kind === 'edit') return inside(ctx.workspace, a.path) ? { tier: 'log' } : { tier: 'gate', rule: 'A7', why: 'edits outside the workspace' };
  for (const [rule, re, why] of SHELL_RULES) if (views.some((v) => re.test(v))) return { tier: 'gate', rule, why };
  const pushes = views.filter((v) => /\bgit\s+push\b/i.test(v));
  if (pushes.some((v) => /(\s-f\b|--force)/i.test(v) || /\s\+\S/.test(v))) return { tier: 'gate', rule: 'A3', why: 'force push' };
  if (pushes.some((v) => PROTECTED_BRANCH.test(pushTarget(v) ?? ''))) return { tier: 'gate', rule: 'A3', why: 'push to a production or release branch' };
  if (views.some((v) => (NET.test(v) || /\bgh\s+gist\s+create\b/i.test(v)) && (LEAVING.test(v) || SECRET_VAR.test(v)))) return { tier: 'gate', rule: 'A4', why: 'sends secrets off the machine' };
  const fresh = views.some((v) => NET.test(v) || /\bgit\s+(push|remote\s+(add|set-url))\b/i.test(v)) && hostsOf(a.command, words).find((h) => !ctx.knownHosts?.has(h));
  if (fresh) return { tier: 'gate', rule: 'A5', why: `first send to ${fresh}` };
  return { tier: 'log' };
}

/** A9: auto mode pauses after 3 blocks in a row or 20 in total. */
export class BlockCounter {
  private row = 0;
  private total = 0;
  record(blocked: boolean): boolean {
    this.row = blocked ? this.row + 1 : 0;
    if (blocked) this.total++;
    return this.row >= 3 || this.total >= 20;
  }
}
