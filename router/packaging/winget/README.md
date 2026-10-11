# winget

Not submitted. Before submitting:

1. Pick a licence and replace `LICENCE-NOT-CHOSEN` in `Wasif-ZA.metarouter.locale.en-US.yaml`.
2. Build a Windows zip holding `metarouter.exe` (for example with PyInstaller) and attach it to the
   GitHub release `v0.1.0`. Put its URL and SHA256 (`Get-FileHash <zip>`) in the installer manifest.
3. Check: `winget validate --manifest packaging/winget` then `winget install --manifest packaging/winget`.
4. Submit: copy the three files to `manifests/w/Wasif-ZA/metarouter/0.1.0/` in a fork of
   `microsoft/winget-pkgs` and open a PR (or run `wingetcreate submit packaging/winget`).
