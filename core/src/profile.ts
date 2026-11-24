import fs from 'node:fs';
import path from 'node:path';
import { E, RpcError } from './pipe/errors.ts';
import { homeDir } from './paths.ts';
import { nowIso, ulid } from './time.ts';
import { PROTECTED_PARTS } from '../../workbench/ui/src/kit/check.js';

// M8-07 (ouros-spec 6 "Your profile"): density, theme, parts to hide and reading level. Ouros may propose a change; nothing
// changes without the person's yes, one proposal shows at a time, and every applied change is listed with Undo.
export interface Profile { density: 'comfortable' | 'compact'; theme: string; hide: string[]; reading: 'plain' | 'technical' }
export type Change = { key: 'density'; value: Profile['density'] } | { key: 'theme'; value: string } | { key: 'reading'; value: Profile['reading'] } | { key: 'hide' | 'show'; value: string };
interface Store { profile: Profile; pending: Array<{ id: string; change: Change; why: string; at: string }>; history: Array<{ id: string; change: Change; before: Profile; at: string }> }

/** Parts a profile can never hide: real gates, questions, hand-back lists, the pipeline bar and layout parts. */
export const PROTECTED: string[] = PROTECTED_PARTS;
const DEFAULT: Profile = { density: 'comfortable', theme: '1', hide: [], reading: 'plain' };
const file = () => path.join(homeDir(), 'profile.json');

function load(): Store {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return { profile: { ...DEFAULT, ...s.profile, hide: (s.profile?.hide ?? []).filter((x: unknown) => typeof x === 'string' && !PROTECTED.includes(x)) }, pending: s.pending ?? [], history: s.history ?? [] };
  } catch { return { profile: { ...DEFAULT }, pending: [], history: [] }; }
}

function save(s: Store): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify(s, null, 1));
  fs.renameSync(`${file()}.tmp`, file());
}

/** Why a change cannot be proposed, or null. */
export function changeProblem(c: unknown): string | null {
  const x = c as Change | null;
  if (!x || typeof x !== 'object') return 'change must be {key, value}';
  if (x.key === 'density') return ['comfortable', 'compact'].includes(x.value) ? null : 'density is comfortable or compact';
  if (x.key === 'reading') return ['plain', 'technical'].includes(x.value) ? null : 'reading is plain or technical';
  if (x.key === 'theme') return typeof x.value === 'string' && /^[1-5]$/.test(x.value) ? null : 'theme is 1 to 5';
  if (x.key === 'hide' || x.key === 'show') {
    if (typeof x.value !== 'string' || !/^[a-z]{1,20}$/.test(x.value)) return 'value must be a part name';
    if (x.key === 'hide' && PROTECTED.includes(x.value)) return `${x.value} can never be hidden: gates, questions, hand-back lists, the pipeline bar and layout parts always show`;
    return null;
  }
  return 'key is density, theme, reading, hide or show';
}

function apply(p: Profile, c: Change): Profile {
  if (c.key === 'hide') return { ...p, hide: [...new Set([...p.hide, c.value])] };
  if (c.key === 'show') return { ...p, hide: p.hide.filter((x) => x !== c.value) };
  return { ...p, [c.key]: c.value } as Profile;
}

/** What Settings > Learning shows: the profile, the one proposal waiting for an answer, how many more wait, and the applied changes newest first. */
export function getProfile() {
  const s = load();
  return { profile: s.profile, pending: s.pending[0] ?? null, waiting: Math.max(0, s.pending.length - 1), history: [...s.history].reverse().map(({ id, change, at }) => ({ id, change, at })) };
}

/** Queues a proposed change; it waits behind any proposal already shown and changes nothing until answered yes. */
export function proposeChange(change: unknown, why: unknown): ReturnType<typeof getProfile> {
  const bad = changeProblem(change);
  if (bad) throw new RpcError(E.VALIDATION, bad);
  const s = load();
  if (s.pending.length >= 20) throw new RpcError(E.VALIDATION, 'twenty proposals already wait');
  s.pending.push({ id: `pr_${ulid()}`, change: change as Change, why: typeof why === 'string' ? why.slice(0, 300) : '', at: nowIso() });
  save(s);
  return getProfile();
}

/** The person's answer to the proposal shown: yes applies it and lists it with Undo; no drops it. Only the shown one can be answered. */
export function answerProposal(id: unknown, yes: unknown): ReturnType<typeof getProfile> {
  const s = load();
  const head = s.pending[0];
  if (!head || head.id !== id) throw new RpcError(E.NOT_FOUND, 'that proposal is not the one waiting for an answer');
  s.pending.shift();
  if (yes === true) {
    s.history.push({ id: head.id, change: head.change, before: s.profile, at: nowIso() });
    s.profile = apply(s.profile, head.change);
  }
  save(s);
  return getProfile();
}

/** Undo: the profile goes back to what it was before that change; later changes are undone with it. */
export function undoChange(id: unknown): ReturnType<typeof getProfile> {
  const s = load();
  const i = s.history.findIndex((h) => h.id === id);
  if (i < 0) throw new RpcError(E.NOT_FOUND, 'no applied change with that id');
  s.profile = s.history[i].before;
  s.history = s.history.slice(0, i);
  save(s);
  return getProfile();
}
