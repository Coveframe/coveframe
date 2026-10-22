[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$root='C:\ProgramData\MediaHubLab'
$destination=Join-Path $root 'boot-credential.dpapi'
if (Test-Path -LiteralPath $destination) { throw 'Boot credential already exists; preserve it.' }
$secure=(Get-Content -LiteralPath (Join-Path $root 'lab-credential.dpapi') -Raw) | ConvertTo-SecureString
$plain=[Net.NetworkCredential]::new('', $secure).Password
try {
  $protected=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($plain),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  [IO.File]::WriteAllText($destination,[Convert]::ToBase64String($protected))
} finally { $plain=$null; $secure.Dispose() }
# The parent lab directory already permits only SYSTEM, Administrators, NetworkService and the lab owner.
