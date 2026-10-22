[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$wrapper='C:\Program Files\Jellyfin\Server\nssm.exe'
$application=(& $wrapper get MediaHubLabJellyfin Application).Trim('"')
$parameters=& $wrapper get MediaHubLabJellyfin AppParameters
if ($application -ne 'C:\Program Files\Jellyfin\Server\jellyfin.exe' -or $parameters -notlike '*--datadir "C:\ProgramData\MediaHubLab\data"*') { throw 'Isolated lab service identity required' }
foreach($name in @('MediaHubLabBootOnce','MediaHubLabBootDryRun')) {
  $task=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if($task) {
    if($task.Actions.Execute -notlike '*\wscript.exe' -or $task.Actions.Arguments -notlike '*C:\Program Files\MediaHubLabTools\hidden-launchers\*') { throw 'Task identity mismatch; preserve it' }
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  }
}
Stop-Service -Name MediaHubLabJellyfin -ErrorAction SilentlyContinue
Set-Service -Name MediaHubLabJellyfin -StartupType Manual
# Private data and trusted tools are preserved for review. No recursive cleanup.
