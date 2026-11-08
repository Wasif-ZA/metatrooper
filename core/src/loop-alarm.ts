import { createHash } from 'node:crypto';

/** The choices a user can make when the loop alarm nudges. */
export const NUDGE_OPTIONS = ['pause', 'rewind', 'try-another-way', 'not-a-loop'] as const;

/** One of the nudge choices. */
export type NudgeChoice = typeof NUDGE_OPTIONS[number];

/** The alarm's answer to an observed call. */
export type Verdict = 'ok' | 'nudge' | 'stop';

/** A single tool call with its input and output. */
export interface ToolCall {
  tool: string;
  input: string;
  output: string;
  polling?: boolean;
}

/** Detector that watches repeated identical tool calls. */
export interface LoopAlarm {
  observe(call: ToolCall): Verdict;
  choose(choice: NudgeChoice): void;
  readonly streak: number;
  readonly falseAlarms: number;
  readonly nudges: number;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Creates a loop alarm that nudges at nudgeAt and stops at stopAt identical calls in a row. */
export function createLoopAlarm(opts: { nudgeAt?: number; stopAt?: number } = {}): LoopAlarm {
  const nudgeAt = opts.nudgeAt ?? 3;
  const stopAt = opts.stopAt ?? 5;
  let lastKey = '';
  let lastDigest = '';
  let streak = 0;
  let falseAlarms = 0;
  let nudges = 0;
  return {
    observe(call) {
      if (call.polling) return 'ok';
      const key = sha(call.tool + '\0' + call.input);
      const digest = sha(call.output);
      streak = key === lastKey && digest === lastDigest ? streak + 1 : 1;
      lastKey = key;
      lastDigest = digest;
      if (streak >= stopAt) return 'stop';
      if (streak >= nudgeAt) {
        nudges += 1;
        return 'nudge';
      }
      return 'ok';
    },
    choose(choice) {
      if (choice === 'not-a-loop') {
        falseAlarms += 1;
        streak = 0;
      }
    },
    get streak() { return streak; },
    get falseAlarms() { return falseAlarms; },
    get nudges() { return nudges; },
  };
}
