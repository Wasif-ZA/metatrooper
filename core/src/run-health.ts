export type HealKind = 'retry' | 'json-repair' | 'loop-stop';

// Lines that look like a test failure or re-run are never infra recoveries.
const NOT_HEAL = /\b(test|tests|spec|vitest|jest|assert\w*|rerun|re-run)\b.*\b(fail\w*|error)\b|\b(fail\w*)\b.*\b(test|tests|re-?run)\b/i;
// An overload error (529 or overloaded) that is being retried.
const RETRY = /(\b529\b|overloaded).*(retry|attempt\s+\d+\s+of\s+\d+)|(retry|attempt\s+\d+\s+of\s+\d+).*(\b529\b|overloaded)/i;
// A truncated or malformed JSON payload that was repaired.
const JSON_REPAIR = /(truncated|malformed|invalid|partial)\s+json.*repair|repair\w*.*(truncated|malformed|invalid|partial)\s+json/i;
// A loop that was detected and stopped.
const LOOP_STOP = /loop.*(stopped|broken|halted)|(stopped|halted).*loop/i;

// Classifies a log line as an infra recovery kind, or null.
export function healKind(line: string): HealKind | null {
  if (NOT_HEAL.test(line)) return null;
  if (RETRY.test(line)) return 'retry';
  if (JSON_REPAIR.test(line)) return 'json-repair';
  if (LOOP_STOP.test(line)) return 'loop-stop';
  return null;
}

const HEAL_TEXT: Record<HealKind, string> = {
  retry: '529 retried with backoff',
  'json-repair': 'truncated JSON repaired',
  'loop-stop': 'loop stopped',
};

// Builds the display line for a heal, with an optional detail in parentheses.
export function healLine(kind: HealKind, detail?: string): string {
  return `\u21bb ${HEAL_TEXT[kind]}${detail ? ` (${detail})` : ''}`;
}

// Counts lines that are infra recoveries.
export function countHealed(lines: string[]): number {
  return lines.filter((l) => healKind(l) !== null).length;
}

// Status bar label such as "3 healed", empty for zero.
export function healedLabel(n: number): string {
  return n > 0 ? `${n} healed` : '';
}

// Maps token use against the cap to ok, log (80%) or gate (100%).
export function budgetStep(used: number, cap: number): 'ok' | 'log' | 'gate' {
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) return 'ok';
  if (used >= cap) return 'gate';
  return used >= cap * 0.8 ? 'log' : 'ok';
}

// Tile footer such as "164k of 200k tokens".
export function budgetFooter(used: number, cap: number): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  return `${k(used)} of ${k(cap)} tokens`;
}

// Orders replayed steps and flags send, deploy and publish steps as ask-first.
export function replayPlan(
  steps: { id: string; kind: string; summary: string }[],
): { id: string; summary: string; ask: boolean }[] {
  return steps.map((s) => ({
    id: s.id,
    summary: s.summary,
    ask:
      s.kind === 'send' ||
      s.kind === 'deploy' ||
      /^deploy/i.test(s.summary) ||
      /git push|npm publish/i.test(s.summary),
  }));
}
