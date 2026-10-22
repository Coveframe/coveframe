param([Parameter(Mandatory=$true)][string]$Package)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$artifacts = Join-Path $root 'artifacts'
if (Get-NetTCPConnection -LocalPort 18797 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 18797 is already in use. No listener was changed.' }
Add-Type -Path (Join-Path $PSScriptRoot 'LauncherWindowProbe.cs')
$fixture = Join-Path $artifacts ('portable-smoke-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture | Out-Null
Expand-Archive -LiteralPath $Package -DestinationPath $fixture
$priorData = $env:MEDIA_HUB_DATA_DIR
$env:MEDIA_HUB_DATA_DIR = Join-Path $fixture 'test-data'
$url = 'http://127.0.0.1:18797'
$headers = $null
function Launch-Fixture {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = Join-Path $fixture 'Coveframe.exe'
  $info.Arguments = '--check'
  $info.WorkingDirectory = $fixture
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.WindowStyle = 'Hidden'
  $exitCode = 0
  $windows = [LauncherWindowProbe]::Run($info, [ref]$exitCode)
  if ([LauncherWindowProbe]::ExternalEvents.Count) { Write-Output ('Unrelated window events retained: ' + ([LauncherWindowProbe]::ExternalEvents -join ',')) }
  if ($exitCode -ne 0 -or $windows.Count -ne 0) { throw "Portable launcher failed or showed console/browser windows; exit=$exitCode events=$($windows -join ',')" }
}
function Session-Headers {
  $page = Invoke-WebRequest -UseBasicParsing -Uri $url
  $match = [regex]::Match($page.Content, 'name="media-hub-token" content="([a-f0-9]+)"')
  if (-not $match.Success) { throw 'Local session proof missing' }
  return @{ 'x-media-hub-token' = $match.Groups[1].Value }
}
function Stop-Fixture {
  Invoke-RestMethod -Uri ($url + '/api/stop') -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' | Out-Null
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -LocalPort 18797 -State Listen -ErrorAction SilentlyContinue) { throw 'Fixture failed to stop its local listener' }
}
try {
  Launch-Fixture
  $headers = Session-Headers
  $listener = Get-NetTCPConnection -LocalPort 18797 -State Listen
  $nodeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if ($nodeProcess.ExecutablePath -ne (Join-Path $fixture 'runtime\node.exe')) { throw 'Portable app did not use its bundled runtime' }
  if ($listener.LocalAddress -ne '127.0.0.1') { throw 'Portable app is not confined to loopback' }
  Launch-Fixture
  if ((Get-NetTCPConnection -LocalPort 18797 -State Listen).OwningProcess -ne $listener.OwningProcess) { throw 'Duplicate launch started another process' }
  $choices = @{ providers = @(@{id='torbox';plan='essential'},@{id='real-debrid';plan='premium'}); useUsenet=$false; televisions='2'; profiles='3'; tv='firetv' } | ConvertTo-Json -Depth 5 -Compress
  $save = Invoke-RestMethod -Uri ($url + '/api/plan') -Method Post -Headers $headers -ContentType 'application/json' -Body $choices
  if (-not $save.ok -or $save.plan.streamingReady) { throw 'Saved setup incorrectly reports playback readiness' }
  $preferences = @{value=@{autoAdvance=$false;trailerPreview=$false;themeMusic=$true}} | ConvertTo-Json -Compress
  $settings = Invoke-RestMethod -Uri ($url + '/api/settings/moonfin') -Method Post -Headers $headers -ContentType 'application/json' -Body $preferences
  if ($settings.application.moonfin -ne 'pending') { throw 'Stopped media incorrectly reports applied settings' }
  # Disconnect on an empty account exercises actual DPAPI persistence without using real keys.
  Invoke-RestMethod -Uri ($url + '/api/accounts/torbox/disconnect') -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' | Out-Null
  Invoke-RestMethod -Uri ($url + '/api/downloads/radarr/disconnect') -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' | Out-Null
  $blockedSearch = $false
  try { Invoke-RestMethod -Uri ($url + '/api/discovery/search') -Method Post -Headers $headers -ContentType 'application/json' -Body '{"query":"example"}' | Out-Null }
  catch { if ([int]$_.Exception.Response.StatusCode -eq 422) { $blockedSearch = $true } else { throw } }
  if (-not $blockedSearch) { throw 'Disconnected discovery did not block search' }
  Stop-Fixture
  Launch-Fixture
  $headers = Session-Headers
  $state = Invoke-RestMethod -Uri ($url + '/api/state') -Headers $headers
  if ($state.plan.household.televisions -ne 2 -or $state.plan.providers.Count -ne 2) { throw 'Saved setup did not survive restart' }
  if (-not $state.settings.preferences.moonfin.themeMusic -or $state.settings.preferences.moonfin.autoAdvance) { throw 'Custom settings did not survive restart' }
  if ($state.downloads.radarr.configured -or $state.downloads.sonarr.pipelineReady) { throw 'Empty download connections incorrectly report readiness' }
  $reset = Invoke-RestMethod -Uri ($url + '/api/settings/moonfin/reset') -Method Post -Headers $headers -ContentType 'application/json' -Body '{}'
  if ($reset.preferences.moonfin.themeMusic -or -not $reset.preferences.moonfin.autoAdvance -or $reset.preferences.aio.maxResolution -ne 'any') { throw 'Section default reset failed' }
  Stop-Fixture
  $headers = $null
  [pscustomobject]@{ pass=$true; bundledRuntime=$true; loopbackOnly=$true; duplicateLaunchReused=$true; saveResume=$true; settingsSaveResumeReset=$true; dpapiReopened=$true; downloadConnectionsReopened=$true; disconnectedSearchBlocked=$true; launcherVisibleWindowEvents=0; stopped=$true; browserFlowTested=$false; providerAccountsTested=$false; bootTested=$false } | ConvertTo-Json -Compress
} finally {
  if ($headers) { try { Stop-Fixture } catch { Write-Warning 'Fixture cleanup needs inspection; no unrelated processes were stopped.' } }
  $env:MEDIA_HUB_DATA_DIR = $priorData
  # Preserve smoke folder and receipts; it contains synthetic choices and encrypted empty account data only.
}
