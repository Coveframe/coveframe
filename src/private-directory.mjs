import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

// Vendor apps store session/API tokens in their own files. Restrict their parent before first launch.
export async function makePrivateDirectory(path) {
  await mkdir(path,{recursive:true});
  // Avoid propagating the same ACL through tens of thousands of vendor files on every restart.
  // A changed or inherited ACL is still replaced before any vendor app may start.
  const script = "$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $current=[IO.Directory]::GetAccessControl($p); $rules=@($current.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); if($current.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference -eq $sid -and $rules[0].AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rules[0].FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and $rules[0].InheritanceFlags -eq ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit) -and $rules[0].PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None){exit 0}; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [IO.Directory]::SetAccessControl($p,$acl)";
  await new Promise((yes,no) => {
    const child=execFile(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],
      {windowsHide:true,timeout:20000,maxBuffer:4096},error => error ? no(Error('Could not protect the private app directory. No app was started.')) : yes());
    child.stdin.on('error',()=>{}); child.stdin.end(path);
  });
}
