[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Read-AuditPolicy.ps1')
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$machine = Get-CimInstance Win32_ComputerSystemProduct
$edition = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$machineBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$machine.UUID)
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $machineId = -join ($hasher.ComputeHash($machineBytes) | ForEach-Object { $_.ToString('x2') }) }
finally { $hasher.Dispose() }
$inventory = [ordered]@{
  schemaVersion = 1
  collectedAt = [DateTime]::UtcNow.ToString('o')
  machineId = $machineId
  editionId = $edition.EditionID
  osCaption = $os.Caption
  buildNumber = [int]$os.BuildNumber
  architecture = [System.Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE', 'Machine')
  manufacturer = $computer.Manufacturer
  model = $computer.Model
  bootStartedAt = $os.LastBootUpTime.ToUniversalTime().ToString('o')
  audit = Get-LogonAuditPolicy
  gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
    [ordered]@{ name = $_.Name; driverVersion = $_.DriverVersion }
  })
  services = @(Get-CimInstance Win32_Service | Where-Object {
    $_.Name -match 'jellyfin|seerr|aiostream|mediahub|media-hub|sonarr|radarr'
  } | ForEach-Object {
    [ordered]@{ name = $_.Name; state = $_.State; startMode = $_.StartMode; identity = $_.StartName }
  })
  listeners = @(Get-NetTCPConnection -State Listen | Where-Object {
    $_.LocalPort -in @(8096,8920,5055,3000,18796,18797,18798,18799,18800)
  } | ForEach-Object { [ordered]@{ address = $_.LocalAddress; port = [int]$_.LocalPort } })
}
$inventory | ConvertTo-Json -Depth 8 -Compress
