# M5-2 Code signing

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 0.5 CC days after Wasif's pick. Replaces the SignPath plan in
`issues/31-signed-installer.md` (SignPath rejected 2026-10-08, M2-STATUS.md M2-07).

## Current state

D50: no unsigned release. Smart App Control blocks unsigned binaries on laptop-ops (spec "Current state"). The two
remaining options are Certum Open Source Code Signing (cloud, from EUR 49 a year, individuals worldwide) and OSSign
(free for open source). Azure Artifact Signing is US and Canada only for individuals.

## What to build

1. Wasif picks the provider, opens the account and passes the identity check (days to weeks for Certum).
2. `workbench/bin/sign.ps1`: signs every `.exe`, `.node` and the conpty `.dll` in the packaged app (M5-1), then the
   installer, with an RFC 3161 timestamp. Certum cloud signing needs his 2FA per session, so signing runs on his
   machine as the last release step, not unattended in CI.
3. Rewrite `issues/31-signed-installer.md` and M2-07 off SignPath; spec D50 names the chosen provider.

## Acceptance criteria

- M5-02a. `Get-AuthenticodeSignature` reports `Valid` for every `.exe`, `.node` and `.dll` under the install folder
  and for the installer.
- M5-02b. With Smart App Control on, the installer and the installed app both start (same run as M5-01a).
