param([ValidateSet("win-x64","win-arm64")][string]$Runtime="win-x64")
$ErrorActionPreference="Stop"
$root=Split-Path $PSScriptRoot -Parent
$dest=Join-Path $root "artifacts/Seasonote-$Runtime"
dotnet publish (Join-Path $root "seasons/windows/Seasonote.csproj") -c Release -r $Runtime --self-contained true -o $dest
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
$web=Join-Path $dest "web"
New-Item -ItemType Directory -Force $web | Out-Null
Get-ChildItem (Join-Path $root "seasons") -File | Where-Object {$_.Extension -in ".html",".css",".js"} | Copy-Item -Destination $web
foreach($name in @("assets","vendor")) { Copy-Item (Join-Path $root "seasons/$name") $web -Recurse -Force }
Copy-Item (Join-Path $root "seasons/windows/licenses") $dest -Recurse -Force
Copy-Item (Join-Path $root "seasons/windows/README.txt") (Join-Path $dest "使用方法.txt")
Copy-Item (Join-Path $root "seasons/windows/Diagnostics.ps1") $dest
Copy-Item (Join-Path $root "seasons/windows/Diagnostics.cmd") (Join-Path $dest "导出诊断.cmd")
Copy-Item (Join-Path $root "LICENSE") $dest
Write-Host "Built: $dest — run Seasonote.exe and keep all accompanying files."
