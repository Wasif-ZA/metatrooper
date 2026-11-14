param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$NodeVersion = '24.18.0'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Reset-Output([string]$Target) {
    $full = [IO.Path]::GetFullPath($Target)
    if (-not $full.StartsWith($dist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside dist: $full"
    }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}

function Copy-Items([string]$Source, [string]$Destination, [string[]]$Names) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($name in $Names) {
        Copy-Item -LiteralPath (Join-Path $Source $name) -Destination $Destination -Recurse -Force
    }
}

function Download([string]$Url, [string]$File) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $File }
    catch {
        Write-Host 'PowerShell download failed; retrying with the installed Node TLS client.'
        & node -e "const fs=require('node:fs'); const {Readable}=require('node:stream'); const {pipeline}=require('node:stream/promises'); fetch(process.argv[1]).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return pipeline(Readable.fromWeb(r.body),fs.createWriteStream(process.argv[2]))}).catch(e=>{console.error(e);process.exitCode=1})" $Url $File
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    }
}

function Install-Production([string]$Name, [string[]]$Packages) {
    $source = Join-Path $repo $Name
    $stage = Join-Path $appDir $Name
    foreach ($package in $Packages) {
        $target = Join-Path (Join-Path $stage 'node_modules') $package
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path (Join-Path $source 'node_modules') $package) -Destination $target -Recurse -Force
    }
}

try {
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $dist = Join-Path $repo 'dist'
    $version = (Get-Content -LiteralPath (Join-Path $repo 'workbench/package.json') -Raw | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$') { throw 'Invalid app version' }
    $output = Join-Path $dist "cc-$version-win-x64"
    $archive = "$output.zip"
    $cache = Join-Path $dist '.cache'
    $appDir = Join-Path $output 'resources/app'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    Reset-Output $output
    Reset-Output $archive

    $electronDist = Join-Path $repo 'workbench/node_modules/electron/dist'
    Copy-Items $electronDist $output @(Get-ChildItem -LiteralPath $electronDist -Force | Select-Object -ExpandProperty Name)
    Rename-Item -LiteralPath (Join-Path $output 'electron.exe') -NewName 'cc.exe'
    Remove-Item -LiteralPath (Join-Path $output 'resources/default_app.asar') -Force
    Copy-Items $repo $appDir @('contracts', 'engines', 'plugins', 'router', 'sandbox', 'skills', 'LICENSE', 'THIRD_PARTY_NOTICES.md')
    Copy-Items (Join-Path $repo 'workbench') (Join-Path $appDir 'workbench') @('src', 'renderer', 'build', 'package.json')
    $coreFiles = @('src', 'dist', 'cli.ts', 'package.json', 'prices.json', 'LICENSE')
    $coreFiles += @(Get-ChildItem -LiteralPath (Join-Path $repo 'core') -Filter '*.js' -File | Select-Object -ExpandProperty Name)
    Copy-Items (Join-Path $repo 'core') (Join-Path $appDir 'core') $coreFiles
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $manifest = [ordered]@{ name = '@metatrooper/workbench'; productName = 'cc'; version = $version; type = 'module'; main = 'workbench/src/main.ts' }
    [IO.File]::WriteAllText((Join-Path $appDir 'package.json'), ($manifest | ConvertTo-Json), $utf8)

    # The core uses this validator at runtime; stage it without the UI build project.
    $kitFiles = @('check.js', 'catalogue.js', 'parts-a.names.js', 'parts-b.names.js', 'parts-c.names.js', 'parts-d.names.js', 'parts-e.names.js')
    Copy-Items (Join-Path $repo 'workbench/ui/src/kit') (Join-Path $appDir 'core/src/ui-kit') $kitFiles
    $surface = Join-Path $appDir 'core/src/surfaces.ts'
    $text = [IO.File]::ReadAllText($surface)
    $old = '../../workbench/ui/src/kit/check.js'
    if (-not $text.Contains($old)) { throw 'Core UI validator import changed; review packaging' }
    [IO.File]::WriteAllText($surface, $text.Replace($old, './ui-kit/check.js'), $utf8)

    Install-Production 'core' @('node-pty', 'node-addon-api', '@xterm/headless', '@xterm/addon-serialize')
    Install-Production 'workbench' @('@xterm/xterm', '@xterm/addon-fit')
    $ptyTarget = Join-Path $appDir 'core/node_modules/node-pty'
    Get-ChildItem -LiteralPath (Join-Path $ptyTarget 'prebuilds') -Directory | Where-Object Name -ne 'win32-x64' | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $output 'locales') -File | Where-Object Name -ne 'en-US.pak' | Remove-Item -Force
    $binaries = @(Get-ChildItem -LiteralPath $ptyTarget -Recurse -Filter '*.node' -File | Where-Object { $_.FullName -match 'prebuilds\\win32-x64\\|build\\Release\\' })
    if ($binaries.Count -eq 0) { throw 'node-pty has no Windows x64 native binaries' }

    $nodeName = "node-v$NodeVersion-win-x64"
    $nodeZip = Join-Path $cache "$nodeName.zip"
    $sums = Join-Path $cache "node-v$NodeVersion-SHASUMS256.txt"
    $base = "https://nodejs.org/dist/v$NodeVersion"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Download "$base/SHASUMS256.txt" $sums
    $pattern = '^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape("$nodeName.zip") + '$'
    $expected = @(Get-Content -LiteralPath $sums | Where-Object { $_ -match $pattern } | ForEach-Object { [regex]::Match($_, $pattern).Groups[1].Value })
    if ($expected.Count -ne 1) { throw 'Node checksum entry missing or ambiguous' }
    if (-not (Test-Path -LiteralPath $nodeZip)) {
        $partial = "$nodeZip.partial"
        Download "$base/$nodeName.zip" $partial
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $expected[0]) { throw 'Node download SHA-256 mismatch' }
        Move-Item -LiteralPath $partial -Destination $nodeZip -Force
    }
    if ((Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash -ne $expected[0]) { throw 'Cached Node SHA-256 mismatch; remove the cached zip and retry' }
    $unpack = Join-Path $cache "$nodeName-unpack"
    Reset-Output $unpack
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $unpack
    Copy-Items (Join-Path $unpack $nodeName) (Join-Path $output 'resources/node') @('node.exe', 'LICENSE')
    Reset-Output $unpack

    foreach ($forbidden in @('workbench/ui', 'workbench/node_modules/electron', 'app.asar')) {
        if (Test-Path -LiteralPath (Join-Path $appDir $forbidden)) { throw "Unexpected packaged path: $forbidden" }
    }
    Compress-Archive -LiteralPath $output -DestinationPath $archive -CompressionLevel Optimal
    $bytes = (Get-ChildItem -LiteralPath $output -Recurse -File | Measure-Object -Property Length -Sum).Sum
    Write-Host ('Folder: {0} ({1:N2} MB)' -f $output, ($bytes / 1MB))
    Write-Host ('Zip:    {0} ({1:N2} MB)' -f $archive, ((Get-Item -LiteralPath $archive).Length / 1MB))
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    exit 1
}
