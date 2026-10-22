[CmdletBinding()]
param([ValidateRange(5,180)][int]$DurationSeconds=45, [switch]$ReadySignal)
$ErrorActionPreference='Stop'
$service=Get-CimInstance Win32_Service -Filter "Name='MediaHubLabJellyfin'"
if (-not $service -or $service.State -ne 'Running') { throw 'The isolated lab service is not running' }
$engine=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($service.ProcessId)" | Where-Object Name -eq 'jellyfin.exe')
if ($engine.Count -ne 1 -or $engine[0].SessionId -ne 0) { throw 'Unique session-zero lab Jellyfin process required' }
$engine=$engine[0]; $processes=@{}; $samples=[Collections.Generic.List[object]]::new(); $partial=0
$deadline=[DateTime]::UtcNow.AddSeconds($DurationSeconds)
if ($ReadySignal) { [Console]::Out.WriteLine('MEDIAHUB_CAPTURE_READY') }
while ([DateTime]::UtcNow -lt $deadline) {
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($engine.ProcessId)" | Where-Object Name -eq 'ffmpeg.exe')) {
    $processes[[string]$child.ProcessId]=[ordered]@{processId=[int]$child.ProcessId;parentProcessId=[int]$child.ParentProcessId;sessionId=[int]$child.SessionId}
  }
  $counterErrors=@()
  $counter=Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction SilentlyContinue -ErrorVariable counterErrors
  if ($counterErrors.Count) { $partial++ }
  foreach ($sample in $counter.CounterSamples) {
    if ($sample.Status -eq 0 -and $sample.InstanceName -match 'pid_(\d+).*engtype_(VideoEncode|VideoDecode)') {
      $ownerId=[int]$Matches[1]; $engineType=$Matches[2]
      if ($processes.ContainsKey([string]$ownerId) -and $sample.CookedValue -gt 0) {
        $samples.Add([ordered]@{at=[DateTime]::UtcNow.ToString('o');processId=$ownerId;engine=$engineType;utilization=[double]$sample.CookedValue})
      }
    }
  }
}
[ordered]@{schemaVersion=1;serviceName=$service.Name;serviceIdentity=$service.StartName;serviceProcessId=[int]$engine.ProcessId
  sessionId=[int]$engine.SessionId;ffmpegProcesses=@($processes.Values);gpuSamples=@($samples.ToArray());partialCounterReads=$partial
  qualified=$false;beforeSignIn='not-tested'} | ConvertTo-Json -Depth 8 -Compress
