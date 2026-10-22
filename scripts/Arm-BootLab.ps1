[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SourceProject,[switch]$ResumeStaging)
$ErrorActionPreference='Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) { throw 'Administrator installer required' }
$source=(Resolve-Path -LiteralPath $SourceProject).Path
if ($source -ne 'C:\Projects\media-hub-windows') { throw 'Unexpected qualification project' }
$tools='C:\Program Files\MediaHubLabTools'
$taskName='MediaHubLabBootOnce'
$attemptId=[guid]::NewGuid().ToString()
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Preserve an existing armed boot test' }
$existing=Test-Path -LiteralPath $tools
if ($existing -and -not $ResumeStaging) { throw 'Preserve existing staging; use the explicit repair path' }
$wrapper='C:\Program Files\Jellyfin\Server\nssm.exe'
$application=(& $wrapper get MediaHubLabJellyfin Application).Trim('"')
$parameters=& $wrapper get MediaHubLabJellyfin AppParameters
if ($application -ne 'C:\Program Files\Jellyfin\Server\jellyfin.exe' -or $parameters -notlike '*--datadir "C:\ProgramData\MediaHubLab\data"*') { throw 'Isolated lab service identity required' }
$inventory=(& (Join-Path $source 'scripts\Get-HostInventory.ps1')) | ConvertFrom-Json
if ($inventory.editionId -notin @('Professional','ProfessionalN')) { throw 'This boot kit is explicitly scoped to Pro development' }
if ($inventory.audit.successEnabled -ne $true) { throw 'Successful-logon auditing is not available; no audit settings were changed' }
$autoLogon=(Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon
if ($autoLogon -eq '1') { throw 'Automatic Windows sign-in prevents this proof; no sign-in settings were changed' }
if ($existing) {
  $prior=Get-Content -LiteralPath (Join-Path $tools 'boot-manifest.json') -Raw | ConvertFrom-Json
  $owner=(Get-Acl -LiteralPath $tools).GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($prior.machineId -ne $inventory.machineId -or $prior.mode -ne 'pro-development' -or $owner -ne 'S-1-5-32-544') { throw 'Existing staging identity mismatch' }
  $backup=Join-Path $tools ('repair-backup-'+$attemptId)
  New-Item -ItemType Directory -Path $backup | Out-Null
  foreach($name in @('boot-manifest.json','preboot.json')) {
    Copy-Item -LiteralPath (Join-Path $tools $name) -Destination (Join-Path $backup $name)
  }
} else { New-Item -ItemType Directory -Path $tools | Out-Null }
& icacls.exe $tools /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect boot tools' }
foreach($directory in @('scripts','src','artifacts','hidden-launchers')) {
  if(-not (Test-Path -LiteralPath (Join-Path $tools $directory))) { New-Item -ItemType Directory -Path (Join-Path $tools $directory) | Out-Null }
}
foreach($file in @('scripts\Run-BootLab.ps1','scripts\Get-HostInventory.ps1','scripts\Read-AuditPolicy.ps1',
  'scripts\Capture-RunEvidence.ps1','scripts\probe-lab.mjs','scripts\evaluate-local-boot.mjs','scripts\evaluate-boot-preparation.mjs',
  'src\boot-preparation.mjs','src\local-boot.mjs','src\transcode.mjs','src\hls.mjs')) {
  if ($existing -and (Test-Path -LiteralPath (Join-Path $tools $file))) { Copy-Item -LiteralPath (Join-Path $tools $file) -Destination (Join-Path $backup ($file.Replace('\','-'))) }
  Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $tools $file) -Force
}
Copy-Item -LiteralPath 'C:\Program Files\nodejs\node.exe' -Destination (Join-Path $tools 'node.exe')
$inventory | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $tools 'preboot.json') -Encoding UTF8
[ordered]@{schemaVersion=1;attemptId=$attemptId;machineId=$inventory.machineId;baselineBootAt=$inventory.bootStartedAt
  createdAt=[DateTimeOffset]::UtcNow.ToString('o');expiresAt=[DateTimeOffset]::UtcNow.AddHours(24).ToString('o')
  purpose='One finite isolated Pro before-sign-in service test';mode='pro-development'} | ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $tools 'boot-manifest.json') -Encoding UTF8
. 'C:\Projects\Project Memory\automation\routine-work\hidden-task-action.ps1'
$action=New-HiddenScheduledTaskAction -TaskName $taskName -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $tools 'scripts\Run-BootLab.ps1')+'" -AttemptId '+$attemptId) -WorkingDirectory $tools -LauncherDirectory (Join-Path $tools 'hidden-launchers')
& icacls.exe $tools /setowner '*S-1-5-32-544' /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not establish trusted boot-tool ownership' }
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$trigger=New-ScheduledTaskTrigger -AtStartup
$trigger.Delay='PT30S'
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 8) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# Prove the SYSTEM credential and launcher on this boot before registering the next-boot action.
$dryName='MediaHubLabBootDryRun'
if(Get-ScheduledTask -TaskName $dryName -ErrorAction SilentlyContinue) { throw 'An earlier dry-run task exists; preserve it for inspection' }
$dryAction=New-HiddenScheduledTaskAction -TaskName $dryName -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $tools 'scripts\Run-BootLab.ps1')+'" -DryRun -AttemptId '+$attemptId) -WorkingDirectory $tools -LauncherDirectory (Join-Path $tools 'hidden-launchers')
& icacls.exe $tools /setowner '*S-1-5-32-544' /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the dry-run launcher ownership' }
Register-ScheduledTask -TaskName $dryName -Action $dryAction -Principal $principal -Settings $settings | Out-Null
$drySucceeded=$false
try {
  Start-ScheduledTask -TaskName $dryName
  $attemptDirectory=Join-Path $tools ('artifacts\'+$attemptId)
  $dryPath=Join-Path $attemptDirectory 'dry-run.json'
  $dryFinished=Join-Path $attemptDirectory 'dry-run-result.json'
  for($attempt=0;$attempt -lt 150;$attempt++) {
    $dryTask=Get-ScheduledTask -TaskName $dryName
    if((Test-Path -LiteralPath $dryFinished) -and $dryTask.State -ne 'Running'){break}
    Start-Sleep -Seconds 1
  }
  $info=Get-ScheduledTaskInfo -TaskName $dryName
  [ordered]@{lastTaskResult=$info.LastTaskResult;lastRunTime=$info.LastRunTime.ToUniversalTime().ToString('o');
    resultExists=(Test-Path -LiteralPath $dryFinished);attemptId=$attemptId} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $attemptDirectory 'dry-task-info.json') -Encoding UTF8
  if(-not (Test-Path -LiteralPath $dryFinished) -or -not (Test-Path -LiteralPath $dryPath)) { throw 'SYSTEM dry run did not complete; next-boot test was not armed' }
  $assessment=& (Join-Path $tools 'node.exe') (Join-Path $tools 'scripts\evaluate-boot-preparation.mjs') $attemptDirectory $attemptId ([string]$dryTask.State) ([string]$info.LastTaskResult)
  $assessment | Set-Content -LiteralPath (Join-Path $attemptDirectory 'preparation-result.json') -Encoding UTF8
  if ($LASTEXITCODE -ne 0 -or ($assessment | ConvertFrom-Json).status -ne 'ready-to-arm') { throw 'Fresh SYSTEM dry run failed; inspect sanitized attempt receipts' }
  $drySucceeded=$true
} finally {
  Stop-ScheduledTask -TaskName $dryName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $dryName -Confirm:$false -ErrorAction SilentlyContinue
  if (-not $drySucceeded) {
    Stop-Service -Name MediaHubLabJellyfin -ErrorAction SilentlyContinue
    Set-Service -Name MediaHubLabJellyfin -StartupType Manual
  }
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Media Hub Windows: one finite isolated Pro startup test; no TV playback; expires after 24h.' | Out-Null
Set-Service -Name MediaHubLabJellyfin -StartupType Automatic
Stop-Service -Name MediaHubLabJellyfin
[ordered]@{schemaVersion=1;status='armed';attemptId=$attemptId;taskName=$taskName;serviceName='MediaHubLabJellyfin';tools=$tools
  expiresAt=[DateTimeOffset]::UtcNow.AddHours(24).ToString('o');rebootRequested=$false;productionChanged=$false} | ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $source 'artifacts\boot-arm.json') -Encoding UTF8
