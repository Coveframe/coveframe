[CmdletBinding()]
param([switch]$DryRun,[Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')][string]$AttemptId)
$ErrorActionPreference='Stop'
$tools=Split-Path -Parent $PSScriptRoot
$serviceName='MediaHubLabJellyfin'
$taskName='MediaHubLabBootOnce'
$wrapper='C:\Program Files\Jellyfin\Server\nssm.exe'
$receipt=[ordered]@{schemaVersion=1;status='failed';qualified=$false;homeCompatibility='unverified';beforeSignIn='not-tested'}
$captureProcess=$null
$ownsService=$false
$collectionCompleted=$false
$attemptDirectory=Join-Path $tools ('artifacts\'+$AttemptId)
function Start-HiddenProcess([string]$Executable,[string]$Arguments) {
  $info=[Diagnostics.ProcessStartInfo]::new()
  $info.FileName=$Executable; $info.Arguments=$Arguments; $info.WorkingDirectory=$tools
  $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  $process=[Diagnostics.Process]::new(); $process.StartInfo=$info
  if (-not $process.Start()) { throw 'Hidden process did not start' }
  return $process
}
try {
  # A consumed/failed attempt keeps its evidence. Never reuse its output directory.
  if (-not (Test-Path -LiteralPath $attemptDirectory)) { New-Item -ItemType Directory -Path $attemptDirectory | Out-Null }
  $destination=Join-Path $attemptDirectory $(if($DryRun){'dry-run-result.json'}else{'boot-result.json'})
  if (Test-Path -LiteralPath $destination) { throw 'Attempt already has a terminal receipt' }
  $service=Get-CimInstance Win32_Service -Filter "Name='MediaHubLabJellyfin'"
  if (-not $service) { throw 'Lab service missing' }
  $parameters=& $wrapper get $serviceName AppParameters 2>$null
  if ($parameters -notlike '*--datadir "C:\ProgramData\MediaHubLab\data"*') { throw 'Lab service identity mismatch' }
  $ownsService=$true
  $manifest=Get-Content -LiteralPath (Join-Path $tools 'boot-manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.attemptId -ne $AttemptId) { throw 'Boot attempt identity mismatch' }
  $current=(& (Join-Path $PSScriptRoot 'Get-HostInventory.ps1')) | ConvertFrom-Json
  if ($current.machineId -ne $manifest.machineId) { throw 'Boot lab machine mismatch' }
  if (-not $DryRun) {
    if ([DateTimeOffset]::UtcNow -gt [DateTimeOffset]::Parse($manifest.expiresAt)) { throw 'Boot test expired' }
    if ($current.bootStartedAt -eq $manifest.baselineBootAt) { throw 'A new boot is required' }
    $claim=[IO.File]::Open((Join-Path $attemptDirectory 'boot-consumed'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $claim.Dispose()
  }
  if ($service.State -ne 'Running') { Start-Service -Name $serviceName }
  $healthy=$false
  for ($attempt=0;$attempt -lt 40;$attempt++) {
    try {
      $public=Invoke-RestMethod -Uri 'http://127.0.0.1:18796/System/Info/Public' -TimeoutSec 2
      if ($public.ServerName -eq 'Media Hub Lab (isolated)') { $healthy=$true;break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $healthy) { throw 'Lab health check failed' }
  $captureArguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'Capture-RunEvidence.ps1')+'" -PreBootFile "'+(Join-Path $tools 'preboot.json')+'" -DurationSeconds 30 -Mode pro-development'
  if ($DryRun) { $captureArguments+=' -AllowCurrentBoot' }
  $captureProcess=Start-HiddenProcess "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" $captureArguments
  $captureOut=$captureProcess.StandardOutput.ReadToEndAsync();$captureError=$captureProcess.StandardError.ReadToEndAsync()
  $probe=Start-HiddenProcess (Join-Path $tools 'node.exe') 'scripts\probe-lab.mjs --machine-secret'
  $probeOut=$probe.StandardOutput.ReadToEndAsync();$probeError=$probe.StandardError.ReadToEndAsync()
  if (-not $probe.WaitForExit(120000)) { $probe.Kill();throw 'Lab playback probe timed out' }
  if ($probe.ExitCode -ne 0) { throw 'Lab playback probe failed; see its sanitized report' }
  if (-not $captureProcess.WaitForExit(150000)) { $captureProcess.Kill();throw 'Audit capture timed out' }
  if ($captureProcess.ExitCode -ne 0) { throw 'Audit capture failed' }
  $receipt=[ordered]@{schemaVersion=1;attemptId=$AttemptId;platform='Windows Pro';mode='pro-development';baselineBootAt=$manifest.baselineBootAt
    bootAt=$current.bootStartedAt;capture=($captureOut.Result | ConvertFrom-Json);probe=($probeOut.Result | ConvertFrom-Json)
    qualified=$false;homeCompatibility='unverified';externalPlayback='not-tested';dryRun=[bool]$DryRun}
  $raw=Join-Path $attemptDirectory $(if($DryRun){'dry-run'}else{'boot-run'})+'.json'
  $receipt | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $raw -Encoding UTF8
  $evaluate=Start-HiddenProcess (Join-Path $tools 'node.exe') ('scripts\evaluate-local-boot.mjs "'+$raw+'"')
  $evaluation=$evaluate.StandardOutput.ReadToEndAsync();$evaluationError=$evaluate.StandardError.ReadToEndAsync()
  if (-not $evaluate.WaitForExit(10000) -or $evaluate.ExitCode -ne 0) { throw 'Evidence evaluation failed' }
  $receipt=$evaluation.Result | ConvertFrom-Json
  $collectionCompleted=$true
} catch {
  # Fixed stage errors only. Never persist command output, URLs, tokens or raw FFmpeg logs.
  $receipt=[ordered]@{schemaVersion=1;status='failed';qualified=$false;homeCompatibility='unverified';error=$_.Exception.Message;dryRun=[bool]$DryRun}
} finally {
  if ($captureProcess -and -not $captureProcess.HasExited) { $captureProcess.Kill() }
  if (-not $DryRun) {
    # The task is finite and its disposable service does not remain running after collection.
    if ($ownsService) {
      Stop-Service -Name $serviceName -ErrorAction SilentlyContinue
      Set-Service -Name $serviceName -StartupType Manual -ErrorAction SilentlyContinue
    }
    Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
  }
  $receipt=[pscustomobject]$receipt
  $receipt | Add-Member -NotePropertyName attemptId -NotePropertyValue $AttemptId -Force
  $receipt | Add-Member -NotePropertyName dryRun -NotePropertyValue ([bool]$DryRun) -Force
  $receipt | Add-Member -NotePropertyName collectionCompleted -NotePropertyValue $collectionCompleted -Force
  if ($destination -and -not (Test-Path -LiteralPath $destination)) {
    $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $destination -Encoding UTF8
  }
}
if (-not $collectionCompleted) { exit 1 }
