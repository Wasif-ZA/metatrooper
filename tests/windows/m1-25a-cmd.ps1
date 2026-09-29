# M1-25a (.cmd half): run on laptop-ops (Windows). Expect: ok 1 test passed, 0 skipped for the .cmd test.
Set-Location (Join-Path $PSScriptRoot '..\..\core')
node --test --test-name-pattern "M1-25a an action runs a .cmd script by name" test/plugins.test.ts
