[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PreBootFile,
  [ValidateRange(5,300)][int]$DurationSeconds = 130,
  [ValidateSet('qualification-home','pro-development')][string]$Mode = 'qualification-home',
  [switch]$AllowCurrentBoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Read-AuditPolicy.ps1')
$inventory = (& (Join-Path $PSScriptRoot 'Get-HostInventory.ps1')) | ConvertFrom-Json
$editions = if ($Mode -eq 'pro-development') { @('Professional','ProfessionalN') } else { @('Core','CoreN','CoreSingleLanguage','CoreCountrySpecific') }
if ($inventory.editionId -notin $editions -or $inventory.buildNumber -lt 22000) {
  throw 'Capture platform does not match the explicitly selected qualification mode.'
}
$ServiceName = 'MediaHubLabJellyfin'
$preBoot = Get-Content -LiteralPath $PreBootFile -Raw | ConvertFrom-Json
if ($preBoot.PSObject.Properties.Name -contains 'inventory') { $preBoot = $preBoot.inventory }
$boot = [DateTimeOffset]::Parse($inventory.bootStartedAt).UtcDateTime
if ($preBoot.machineId -ne $inventory.machineId -or (-not $AllowCurrentBoot -and [DateTimeOffset]::Parse($preBoot.collectedAt).UtcDateTime -ge $boot)) {
  throw 'Pre-boot inventory must be from this lab machine and precede this boot.'
}
$service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
if (-not $service -or $service.State -ne 'Running') { throw 'The selected lab service is not running.' }
$manager = Get-CimInstance Win32_Process -Filter "ProcessId=$($service.ProcessId)"
$engine = $manager
if ($manager.Name -ne 'jellyfin.exe') {
  $engines = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($manager.ProcessId)" | Where-Object { $_.Name -eq 'jellyfin.exe' })
  if ($engines.Count -ne 1) { throw 'Could not identify the unique Jellyfin process owned by the lab service.' }
  $engine = $engines[0]
}
$samples = [System.Collections.Generic.List[object]]::new()
$processes = @{}
$errors = [System.Collections.Generic.List[string]]::new()
$startedAt = [DateTime]::UtcNow
$deadline = $startedAt.AddSeconds($DurationSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($engine.ProcessId)" | Where-Object { $_.Name -eq 'ffmpeg.exe' })
  foreach ($child in $children) {
    $processes[[string]$child.ProcessId] = [ordered]@{
      processId = [int]$child.ProcessId; parentProcessId = [int]$child.ParentProcessId
      startedAt = $child.CreationDate.ToUniversalTime().ToString('o')
    }
  }
  try {
    $counter = Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop
    foreach ($sample in $counter.CounterSamples) {
      if ($sample.InstanceName -match 'pid_(\d+).*engtype_(VideoEncode|VideoDecode)') {
        $ownerId = [int]$Matches[1]; $engineType = $Matches[2]
        if ($processes.ContainsKey([string]$ownerId)) {
          $samples.Add([ordered]@{ at = [DateTime]::UtcNow.ToString('o'); processId = $ownerId
            engine = $engineType; utilization = [double]$sample.CookedValue })
        }
      }
    }
  } catch { if (-not $errors.Contains('gpu-counters-unavailable')) { $errors.Add('gpu-counters-unavailable') } }
  Start-Sleep -Milliseconds 1000
}
$endedAt = [DateTime]::UtcNow
$interactive = [System.Collections.Generic.List[object]]::new()
$policyChanges = [System.Collections.Generic.List[object]]::new()
$cleared = $false; $complete = $true; $oldestAt = $null
$eventStart = if ($AllowCurrentBoot) { $startedAt.AddMinutes(-2) } else { $boot }
try {
  $oldestAt = (Get-WinEvent -LogName Security -Oldest -MaxEvents 1 -ErrorAction Stop).TimeCreated.ToUniversalTime().ToString('o')
  $events = @(Get-WinEvent -FilterHashtable @{LogName='Security'; Id=@(4624,4719,1102); StartTime=$eventStart; EndTime=$endedAt} -MaxEvents 10001 -ErrorAction Stop)
  if ($events.Count -ge 10001) { $complete=$false; $errors.Add('security-event-window-truncated') }
} catch {
  if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*' -and $oldestAt) { $events = @() }
  else { $events = @(); $complete = $false; $errors.Add('security-events-unavailable') }
}
foreach ($event in $events) {
  if ($event.Id -eq 1102) { $cleared = $true }
  if ($event.Id -eq 4719) { $policyChanges.Add([ordered]@{ at=$event.TimeCreated.ToUniversalTime().ToString('o') }) }
  if ($event.Id -eq 4624) {
    [xml]$xml = $event.ToXml(); $data = @{}
    foreach ($item in $xml.Event.EventData.Data) { $data[$item.Name] = [string]$item.'#text' }
    $systemIdentity = $data.TargetUserSid -in @('S-1-5-18','S-1-5-19','S-1-5-20') -or $data.TargetUserSid -match '^S-1-5-(90|96)-'
    if (-not $systemIdentity -and [int]$data.LogonType -in @(2,7,10,11,12,13)) {
      $interactive.Add([ordered]@{ at=$event.TimeCreated.ToUniversalTime().ToString('o'); logonType=[int]$data.LogonType })
    }
  }
}
$policy = Get-LogonAuditPolicy
[ordered]@{
  schemaVersion=1; machineId=$inventory.machineId; bootStartedAt=$inventory.bootStartedAt
  platform=[ordered]@{editionId=$inventory.editionId;mode=$Mode;homeCompatibility='unverified'}
  collectedAt=[DateTime]::UtcNow.ToString('o'); captureStartedAt=$startedAt.ToString('o'); captureEndedAt=$endedAt.ToString('o')
  service=[ordered]@{ name=$service.Name; startMode=$service.StartMode; identity=$service.StartName
    managerProcessId=[int]$manager.ProcessId; processId=[int]$engine.ProcessId; sessionId=[int]$engine.SessionId
    processStartedAt=$engine.CreationDate.ToUniversalTime().ToString('o') }
  audit=[ordered]@{ enabledBeforeBoot=$preBoot.audit.successEnabled; enabledAtCollection=$policy.successEnabled
    complete=$complete; oldestEventAt=$oldestAt; windowStart=$eventStart.ToString('o'); windowEnd=$endedAt.ToString('o')
    interactiveLogons=@($interactive.ToArray()); policyChanges=@($policyChanges.ToArray()); cleared=$cleared }
  ffmpegProcesses=@($processes.Values); gpuSamples=@($samples.ToArray()); errors=@($errors.ToArray())
} | ConvertTo-Json -Depth 10 -Compress
