param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][string]$Output, [string]$Archive, [switch]$ZipOnly)
$ErrorActionPreference = 'Stop'
if ($ZipOnly) {
  if (Test-Path -LiteralPath ($Output + '.zip')) { throw 'Package archive already exists' }
  $packageFiles = @(Get-ChildItem -LiteralPath $Output -Force | Where-Object Name -NE 'node-source' | ForEach-Object FullName)
  Compress-Archive -LiteralPath $packageFiles -DestinationPath ($Output + '.zip') -CompressionLevel Optimal
  exit 0
}
if (Test-Path -LiteralPath $Output) { throw 'Package directory already exists' }
New-Item -ItemType Directory -Path $Output | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Output 'runtime') | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$upstream = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  [IO.Compression.ZipFileExtensions]::ExtractToFile($upstream.GetEntry('node-v24.15.0-win-x64/node.exe'), (Join-Path $Output 'runtime\node.exe'))
  [IO.Compression.ZipFileExtensions]::ExtractToFile($upstream.GetEntry('node-v24.15.0-win-x64/LICENSE'), (Join-Path $Output 'runtime\LICENSE.txt'))
} finally { $upstream.Dispose() }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll ('/out:' + (Join-Path $Output 'Coveframe.exe')) (Join-Path $Root 'launcher\MediaHubLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
