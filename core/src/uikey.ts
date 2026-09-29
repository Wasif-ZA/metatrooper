import crypto from 'node:crypto';
import fs from 'node:fs';
import { homeDir, uiKeyFile } from './paths.ts';

export function rotateUiKey(): string {
  fs.mkdirSync(homeDir(), { recursive: true });
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(uiKeyFile(), key, { encoding: 'utf8', mode: 0o600 });
  return key;
}
