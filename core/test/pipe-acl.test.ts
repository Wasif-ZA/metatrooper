import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildGenerated, harness } from './helpers.ts';

before(buildGenerated);

const WRITE_DATA = 0x2;
const TRUSTED = new Set(['S-1-5-18', 'S-1-5-32-544']);

type Rule = { sid: string; rights: number; allow: boolean };

function writers(rules: Rule[], owner: string): string[] {
  return rules.filter((r) => r.allow && (r.rights & WRITE_DATA) && r.sid !== owner && !TRUSTED.has(r.sid)).map((r) => r.sid);
}

function pipeRules(name: string): { owner: string; rules: Rule[] } {
  const ps = `$c = New-Object IO.Pipes.NamedPipeClientStream('.', $env:ACL_PIPE, [IO.Pipes.PipeDirection]::InOut); $c.Connect(3000);
$a = $c.GetAccessControl(); $c.Dispose();
@{ owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
   rules = @($a.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { @{ sid = $_.IdentityReference.Value; rights = [int]$_.PipeAccessRights; allow = $_.AccessControlType -eq 'Allow' } }) } | ConvertTo-Json -Depth 4 -Compress`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { env: { ...process.env, ACL_PIPE: name }, encoding: 'utf8', windowsHide: true });
  return JSON.parse(out);
}

test('M1-10 writers() flags a non-owner principal with write access', () => {
  assert.deepEqual(writers([{ sid: 'S-1-1-0', rights: 0x3, allow: true }, { sid: 'S-1-1-0', rights: 0x1, allow: true }, { sid: 'S-1-5-18', rights: 0x1f01ff, allow: true }], 'S-1-5-21-x'), ['S-1-1-0']);
});

test('M1-10 owner half: only the owner, SYSTEM and Administrators can write to the core and terminal pipes', { skip: process.platform !== 'win32' }, async () => {
  const h = await harness();
  try {
    for (const name of [h.prefix, `${h.prefix}-term`]) {
      const { owner, rules } = pipeRules(name);
      assert.ok(rules.some((r) => r.sid === owner && r.allow && (r.rights & WRITE_DATA)), `${name}: owner cannot write`);
      assert.deepEqual(writers(rules, owner), [], `${name}: ${JSON.stringify(rules)}`);
    }
  } finally { await h.teardown(); }
});
