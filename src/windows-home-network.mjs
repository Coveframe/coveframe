import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const exec=promisify(execFile);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const ps=code=>exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,maxBuffer:128*1024});
export function createWindowsHomeNetwork({directory}){
 const name='Coveframe-TV-'+createHash('sha256').update(resolve(directory).toLowerCase()).digest('hex').slice(0,16);
 const program=quote(process.execPath),rule=quote(name);
 async function inspect(){
  if(process.platform!=='win32')return {adapters:[],firewallAllowed:false};
  const {stdout}=await ps(`$ErrorActionPreference='Stop'; $adapters=@(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.HardwareInterface } | ForEach-Object { $adapter=$_; $profile=Get-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue; Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' } | ForEach-Object { @{id=[int]$adapter.ifIndex;name=$adapter.Name;address=$_.IPAddress;prefixLength=[int]$_.PrefixLength;category=[string]$profile.NetworkCategory} } }); $rules=@(Get-NetFirewallRule -Name ${rule} -ErrorAction SilentlyContinue); $allowed=$false; foreach($r in $rules){ $p=$r | Get-NetFirewallPortFilter; $a=$r | Get-NetFirewallAddressFilter; $app=$r | Get-NetFirewallApplicationFilter; if($r.Group -eq 'Coveframe home TV' -and $r.Enabled -eq 'True' -and $r.Direction -eq 'Inbound' -and $r.Action -eq 'Allow' -and [string]$r.Profile -eq 'Private' -and [string]$p.LocalPort -eq '18799' -and [string]$p.Protocol -eq 'TCP' -and [string]$a.RemoteAddress -eq 'LocalSubnet' -and $app.Program -eq ${program}){$allowed=$true} }; @{adapters=$adapters;firewallAllowed=$allowed} | ConvertTo-Json -Depth 4 -Compress`);
  return JSON.parse(stdout.replace(/^\uFEFF/,''));
 }
 async function elevated(remove){
  const folder=join(directory,'Permission');await mkdir(folder,{recursive:true});
  const receipt=join(folder,randomUUID()+'.json'),wrapper=receipt+'.vbs';
  // GUI-subsystem wscript launches the UAC action hidden. No console fallback.
  const action=remove?`Get-NetFirewallRule -Name ${rule} -ErrorAction SilentlyContinue | Where-Object { $_.Group -eq 'Coveframe home TV' } | Remove-NetFirewallRule`:
   `$existing=Get-NetFirewallRule -Name ${rule} -ErrorAction SilentlyContinue; if($existing -and $existing.Group -ne 'Coveframe home TV'){throw 'Rule conflict'}; if($existing){$existing | Remove-NetFirewallRule}; New-NetFirewallRule -Name ${rule} -DisplayName 'Coveframe — home TV' -Group 'Coveframe home TV' -Description 'Media only; Private home network; no router changes' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort 18799 -RemoteAddress LocalSubnet -Program ${program} | Out-Null`;
  const code=`$ErrorActionPreference='Stop'; try { ${action}; [IO.File]::WriteAllText(${quote(receipt)},'ok') } catch { [IO.File]::WriteAllText(${quote(receipt)},'failed'); exit 1 }`;
  const args='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+Buffer.from(code,'utf16le').toString('base64');
  const vbQuote=value=>'"'+value.replaceAll('"','""')+'"';
  await writeFile(wrapper,`On Error Resume Next\r\nCreateObject("Shell.Application").ShellExecute "powershell.exe", ${vbQuote(args)}, "", "runas", 0\r\nIf Err.Number <> 0 Then WScript.Quit 1\r\n`,{flag:'wx'});
  try{
   await exec('wscript.exe',['//B','//NoLogo',wrapper],{windowsHide:true,timeout:150000});
   for(let attempt=0;attempt<120;attempt++){
    try{const value=await readFile(receipt,'utf8');if(value!=='ok')throw Error('Permission failed');return;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
   throw Error('Permission timed out');
  }finally{await rm(wrapper,{force:true});await rm(receipt,{force:true});}
 }
 return {inspect,allow:()=>elevated(false),async remove(){
  if(process.platform!=='win32')return;
  const {stdout}=await ps(`$owned=@(Get-NetFirewallRule -Name ${rule} -ErrorAction SilentlyContinue | Where-Object { $_.Group -eq 'Coveframe home TV' }); if($owned.Count -gt 0){'present'}else{'absent'}`);
  if(stdout.trim()==='present')await elevated(true);
 }};
}
