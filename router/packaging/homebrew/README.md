# Homebrew

Not submitted. Before submitting:

1. Pick a licence and replace `LICENCE-NOT-CHOSEN` in `metarouter.rb` with its SPDX id.
2. Publish the sdist to PyPI, then put its SHA256 in `sha256` (`shasum -a 256 metarouter-0.1.0.tar.gz`).
3. Check on a Mac: `brew install --build-from-source ./packaging/homebrew/metarouter.rb`, then
   `brew test metarouter` and `brew audit --new --formula metarouter`.
4. Submit: put the formula in your own tap (`Wasif-ZA/homebrew-tap`, users run
   `brew install wasif-za/tap/metarouter`). homebrew-core wants a known, used project first.
