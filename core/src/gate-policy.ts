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

const SHELL_RULES: Array<[Rule, RegExp, string]> = [
  ['A1', /\bgit\s+(reset\s+--hard|clean\s+-\S*[fd]|checkout\s+(--\s+)?\.(\s|$)|restore\s+(?!--staged)\S|stash\s+(drop|clear))/i, 'discards uncommitted work'],
  ['A2', /(\brm\s+(-\S*[rR]|--recursive)|\brmdir\s+\/s|\bdel\s+\/s|remove-item\b[^|;]*-recurse)/i, 'recursive delete'],
  ['A6', /(\b(npm|pnpm|yarn)\s+publish|\b(vercel|netlify|fly|flyctl|wrangler)\s+(deploy|--prod)|\bterraform\s+(apply|destroy)|\bkubectl\s+(apply|delete)|\bdocker\s+push|\bgh\s+release\s+create|\bcargo\s+publish|\btwine\s+upload)/i, 'deploy, publish or shared infrastructure'],
];

function pushTarget(cmd: string): string | null {
  const m = /\bgit\s+push\b(.*)/i.exec(cmd);
  if (!m) return null;
  const args = m[1].trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
  const refspec = args[1] ?? '';
  return refspec.split(':').pop()!.replace(/^\+/, '') || '';
}

function hostsOf(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(/\b(?:https?|ssh|ftp):\/\/(?:[^@\s/]+@)?([^/:\s'"]+)|\b[\w.-]+@([\w.-]+):/g)) out.push((m[1] ?? m[2]).toLowerCase());
  return out;
}

const inside = (root: string, p: string) => {
  const rel = path.relative(path.resolve(root), path.resolve(root, p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Which tier an agent action lands in; the A-list is checked first so it gates in every mode. */
export function classify(a: PolicyAction, ctx: PolicyContext): Verdict {
  if (a.kind === 'question') return { tier: 'decision' };
  const subject = a.kind === 'shell' ? a.command : a.path;
  for (const b of ctx.boundaries ?? []) if (new RegExp(b, 'i').test(subject)) return { tier: 'gate', rule: 'A8', why: `matches your boundary ${b}` };
  if (a.kind === 'edit') return inside(ctx.workspace, a.path) ? { tier: 'log' } : { tier: 'gate', rule: 'A7', why: 'edits outside the workspace' };
  const cmd = a.command;
  for (const [rule, re, why] of SHELL_RULES) if (re.test(cmd)) return { tier: 'gate', rule, why };
  if (/\bgit\s+push\b/i.test(cmd)) {
    if (/(\s-f\b|--force)/i.test(cmd) || /\s\+\S/.test(cmd)) return { tier: 'gate', rule: 'A3', why: 'force push' };
    if (PROTECTED_BRANCH.test(pushTarget(cmd) ?? '')) return { tier: 'gate', rule: 'A3', why: 'push to a production or release branch' };
  }
  if (NET.test(cmd) && LEAVING.test(cmd)) return { tier: 'gate', rule: 'A4', why: 'sends secrets off the machine' };
  const fresh = (NET.test(cmd) || /\bgit\s+(push|remote\s+add)\b/i.test(cmd)) && hostsOf(cmd).find((h) => !ctx.knownHosts?.has(h));
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
