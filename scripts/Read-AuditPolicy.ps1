function Get-LogonAuditPolicy {
  try {
    if (-not ('MediaHubQualification.AuditReader' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace MediaHubQualification {
  public static class AuditReader {
    [StructLayout(LayoutKind.Sequential)]
    private struct AuditPolicy { public Guid Subcategory; public uint Flags; public Guid Category; }
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool AuditQuerySystemPolicy(ref Guid subcategory, uint count, out IntPtr policy);
    [DllImport("advapi32.dll")] private static extern void AuditFree(IntPtr buffer);
    public static uint ReadLogonFlags() {
      Guid subcategory = new Guid("0CCE9215-69AE-11D9-BED3-505054503030");
      IntPtr buffer;
      if (!AuditQuerySystemPolicy(ref subcategory, 1, out buffer)) throw new System.ComponentModel.Win32Exception();
      try { return ((AuditPolicy)Marshal.PtrToStructure(buffer, typeof(AuditPolicy))).Flags; }
      finally { AuditFree(buffer); }
    }
  }
}
'@
    }
    $flags = [MediaHubQualification.AuditReader]::ReadLogonFlags()
    return [ordered]@{ successEnabled = (($flags -band 1) -ne 0); error = $null }
  } catch { return [ordered]@{ successEnabled = $null; error = 'audit-policy-query-unavailable' } }
}
