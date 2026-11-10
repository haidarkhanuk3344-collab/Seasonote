$ErrorActionPreference = 'Continue'
$seasonoteData = Join-Path $env:LOCALAPPDATA 'Seasonote'
$seasonoteReport = [ordered]@{
  CreatedAt = (Get-Date).ToString('o')
  OS = [System.Environment]::OSVersion.VersionString
  ProcessArchitecture = $env:PROCESSOR_ARCHITECTURE
  WebView2 = @()
  SeasonoteProcesses = @(Get-Process Seasonote -ErrorAction SilentlyContinue | Select-Object Id, Responding, MainWindowTitle)
}
foreach ($seasonoteRegistryRoot in @('HKCU:\Software\Microsoft\EdgeUpdate\Clients', 'HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients', 'HKLM:\Software\Microsoft\EdgeUpdate\Clients')) {
  $seasonoteReport.WebView2 += @(Get-ChildItem $seasonoteRegistryRoot -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.name -like '*WebView2*' } | Select-Object name,pv)
}
$seasonoteSettings = Join-Path $seasonoteData 'settings.json'
if (Test-Path $seasonoteSettings) { $seasonoteReport.Settings = Get-Content $seasonoteSettings -Raw }
$seasonoteErrors = Join-Path $seasonoteData 'errors.log'
if (Test-Path $seasonoteErrors) { $seasonoteReport.Errors = @(Get-Content $seasonoteErrors -Tail 80) }
$seasonoteDestination = Join-Path ([Environment]::GetFolderPath('Desktop')) ('Seasonote-diagnostics-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$seasonoteReport | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $seasonoteDestination
Write-Host "已保存诊断文件：$seasonoteDestination"
Write-Host '文件包含系统版本、运行状态、摆件配置和错误记录；发送给制作人前可以先查看内容。'
