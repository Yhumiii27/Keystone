<#
.SYNOPSIS
  Builds Keystone.exe, the Windows application of Keystone PM (R-210), into desktop\windows\dist\.

.DESCRIPTION
  One self-contained file for Windows 10/11 x64: no .NET to install on the PCs; the Microsoft Edge WebView2 runtime is
  needed (part of Windows 11; on Windows 10, installed with Edge or by IT). The exe holds no server and no data: it opens
  the Keystone server named in keystone.json (next to the exe, set by IT) or asked at the first launch.

  Needs the .NET 10 SDK (https://dotnet.microsoft.com/download/dotnet/10.0 or: winget install Microsoft.DotNet.SDK.10).
  Runs the tests of the application's rules first, then dotnet publish. The version is the one of package.json.

  Without a Windows PC: the "Windows app" GitHub Actions workflow (.github/workflows/windows-app.yml), started by hand
  ("Run workflow"), runs this script and offers Keystone.exe for download.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File desktop\windows\build.ps1
.EXAMPLE
  .\desktop\windows\build.ps1 -SkipTests
#>
[CmdletBinding()]
param(
  [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here '..\..')
$dist = Join-Path $here 'dist'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw 'dotnet not found: install the .NET 10 SDK (winget install Microsoft.DotNet.SDK.10), then run again.'
}
$sdks = & dotnet --list-sdks
if (-not ($sdks | Where-Object { $_ -match '^(1\d|[2-9]\d)\.' })) {
  throw "The .NET 10 SDK (or later) is required. Installed SDKs:`n$($sdks -join "`n")"
}

$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
Write-Host "> Keystone $version for Windows (win-x64)"

if (-not $SkipTests) {
  Write-Host '> Tests of the application rules'
  & dotnet test (Join-Path $here 'Keystone.Tests\Keystone.Tests.csproj') -c Release
  if ($LASTEXITCODE -ne 0) { throw "Tests failed (exit code $LASTEXITCODE)." }
}

Write-Host '> Publishing one self-contained file'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
& dotnet publish (Join-Path $here 'Keystone\Keystone.csproj') -c Release -r win-x64 -o $dist "-p:Version=$version"
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (exit code $LASTEXITCODE)." }

$exe = Join-Path $dist 'Keystone.exe'
if (-not (Test-Path $exe)) { throw "Keystone.exe missing from $dist." }
Copy-Item (Join-Path $here 'keystone.example.json') (Join-Path $dist 'keystone.example.json')
$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "OK $exe ($size MB)"
Write-Host "   SHA-256: $hash"
