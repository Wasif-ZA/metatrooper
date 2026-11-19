$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  cargo build --release
  if ($LASTEXITCODE -ne 0) {
    # without the MSVC build tools, Rust's GNU toolchain links with its own bundled MinGW
    Write-Host 'MSVC link failed; trying stable-x86_64-pc-windows-gnu (rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal)'
    cargo +stable-x86_64-pc-windows-gnu build --release
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  $destination = Join-Path $PSScriptRoot '../core/bin'
  New-Item -ItemType Directory -Force $destination | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'target/release/metatrooper-launch.exe') -Destination $destination -Force
} finally { Pop-Location }
