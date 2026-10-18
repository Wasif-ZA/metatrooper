import crypto from 'node:crypto';
import fs from 'node:fs';
import { homeDir, uiKeyFile } from './paths.ts';

export function rotateUiKey(): string {
  fs.mkdirSync(homeDir(), { recursive: true });
  const key = crypto.randomBytes(32).toString('hex');
  const tmp = `${uiKeyFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, key, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, uiKeyFile());
  return key;
}
