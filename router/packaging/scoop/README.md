# scoop

Not submitted. Before submitting:

1. Pick a licence and replace `LICENCE-NOT-CHOSEN` in `metarouter.json`.
2. Publish the sdist to PyPI, then put its SHA256 in `hash` (`Get-FileHash metarouter-0.1.0.tar.gz`).
3. Check: `scoop install ./packaging/scoop/metarouter.json`, then `metarouter --help`.
4. Submit: either host your own bucket (a repo with this file under `bucket/`, users run
   `scoop bucket add metarouter <repo-url>`), or open a PR adding it to `ScoopInstaller/Extras`.
