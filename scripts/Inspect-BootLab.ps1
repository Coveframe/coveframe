[CmdletBinding()]
param([switch]$RefreshRunner)
$ErrorActionPreference='Stop'
$source='C:\Projects\media-hub-windows'
$tools='C:\Program Files\MediaHubLabTools'
$task=Get-ScheduledTask -TaskName 'MediaHubLabBootOnce'
if($task.Actions.Execute -notlike '*\wscript.exe' -or $task.Actions.Arguments -notlike '*C:\Program Files\MediaHubLabTools\hidden-launchers\*' -or $task.Principal.UserId -notin @('SYSTEM','S-1-5-18')) { throw 'Boot task identity mismatch' }
$manifest=Get-Content -LiteralPath (Join-Path $tools 'boot-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.attemptId -notmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or
    $task.Actions.Arguments -notlike '*C:\Program Files\MediaHubLabTools\hidden-launchers\*') {
  throw 'Legacy boot kit requires explicit repair, not an in-place runner refresh'
}
$current=(& (Join-Path $source 'scripts\Get-HostInventory.ps1')) | ConvertFrom-Json
if($manifest.machineId -ne $current.machineId -or $manifest.mode -ne 'pro-development') { throw 'Boot manifest identity mismatch' }
$script=Join-Path $tools 'scripts\Run-BootLab.ps1'
$launcherPath=($task.Actions.Arguments -replace '^//B //NoLogo "','').TrimEnd('"')
$launcher=Get-Content -LiteralPath $launcherPath -Raw
if ($launcher -notmatch [regex]::Escape('-AttemptId '+$manifest.attemptId)) { throw 'Boot launcher attempt identity mismatch' }
if($RefreshRunner) {
  if($task.State -eq 'Running'){throw 'Preserve a running boot test'}
  Copy-Item -LiteralPath $script -Destination ($script+'.backup-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
  Copy-Item -LiteralPath (Join-Path $source 'scripts\Run-BootLab.ps1') -Destination $script -Force
  & icacls.exe $script /setowner '*S-1-5-32-544' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not protect refreshed runner'}
}
$service=Get-CimInstance Win32_Service -Filter "Name='MediaHubLabJellyfin'"
$attemptDirectory=Join-Path $tools ('artifacts\'+$manifest.attemptId)
$dry=Get-Content -LiteralPath (Join-Path $attemptDirectory 'dry-run.json') -Raw | ConvertFrom-Json
$info=Get-ScheduledTaskInfo -TaskName $task.TaskName
[ordered]@{schemaVersion=1;attemptId=$manifest.attemptId;taskName=$task.TaskName;state=[string]$task.State;enabled=$task.Settings.Enabled
  principal=$task.Principal.UserId;execute=$task.Actions.Execute;arguments=$task.Actions.Arguments
  startupDelay=$task.Triggers.Delay;executionTimeLimit=$task.Settings.ExecutionTimeLimit
  hiddenConsoleLauncher=($launcher -match 'shell.Run\(.+, 0, True\)' -and $launcher -match 'ExecutionPolicy Bypass')
  lastTaskResult=$info.LastTaskResult;dryTaskRemoved=($null -eq (Get-ScheduledTask -TaskName MediaHubLabBootDryRun -ErrorAction SilentlyContinue))
  dryRun=[ordered]@{probeStatus=$dry.probe.status;checks=$dry.probe.checks;transcode=$dry.probe.transcode
    service=$dry.capture.service;auditComplete=$dry.capture.audit.complete;interactiveLogons=$dry.capture.audit.interactiveLogons.Count}
  labState=$service.State;labStartMode=$service.StartMode;runnerSha256=(Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash
  sourceRunnerSha256=(Get-FileHash -LiteralPath (Join-Path $source 'scripts\Run-BootLab.ps1') -Algorithm SHA256).Hash
  expiresAt=$manifest.expiresAt;rebootRequested=$false} | ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath (Join-Path $source 'artifacts\boot-live-audit.json') -Encoding UTF8
