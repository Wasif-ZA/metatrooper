import { PARENT_SESSION_ENV } from '../src/terminal/parent-env.ts';

// Strips session identity inherited from an outer cc or Claude Code session.
for (const key of Object.keys(process.env)) {
  const name = key.toUpperCase();
  if (name.startsWith('TROOP_') || PARENT_SESSION_ENV.has(name)) delete process.env[key];
}
