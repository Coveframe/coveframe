using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class LauncherWindowProbe {
    delegate void EventProc(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, EventProc cb, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint extra; }
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint remove);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ENTRY {
        public uint size, usage, pid; public UIntPtr heap; public uint module, threads, parent;
        public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
    }
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32First(IntPtr snapshot, ref ENTRY entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32Next(IntPtr snapshot, ref ENTRY entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static string[] ExternalEvents = new string[0];
    static bool? Owned(uint pid, uint target) {
        var parents = new Dictionary<uint,uint>();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) return null;
        try {
            ENTRY entry = new ENTRY(); entry.size = (uint)Marshal.SizeOf(typeof(ENTRY));
            if (Process32First(snapshot, ref entry)) do { parents[entry.pid] = entry.parent; } while (Process32Next(snapshot, ref entry));
        } finally { CloseHandle(snapshot); }
        for (int i=0; i<64 && pid!=0; i++) {
            if (pid==target) return true;
            if (!parents.ContainsKey(pid)) return i==0 ? (bool?)null : false;
            pid=parents[pid];
        }
        return false;
    }
    public static string[] Run(ProcessStartInfo info, out int exitCode) {
        var own = new List<string>(); var external = new List<string>(); uint target=0;
        EventProc callback = (h,e,w,o,c,t,ms) => {
            if (o!=0 || !IsWindowVisible(w)) return;
            var text = new StringBuilder(256); GetClassName(w,text,256); string cls=text.ToString();
            uint pid; GetWindowThreadProcessId(w,out pid);
            string name; try { name=Process.GetProcessById((int)pid).ProcessName; } catch { name="exited"; }
            if (cls!="ConsoleWindowClass" && cls!="CASCADIA_HOSTING_WINDOW_CLASS" && !(cls=="Chrome_WidgetWin_1" && name=="chrome")) return;
            bool? owned=Owned(pid,target);
            string value=cls+":"+name+":"+pid;
            if (owned==false) external.Add(value); else own.Add((owned==null ? "unknown:" : "owned:")+value);
        };
        IntPtr hook=SetWinEventHook(0x8002,0x8002,IntPtr.Zero,callback,0,0,0);
        if (hook==IntPtr.Zero) throw new Exception("Window hook unavailable");
        try {
            using (var process=Process.Start(info)) {
                target=(uint)process.Id; var timer=Stopwatch.StartNew();
                while (!process.HasExited) {
                    MSG msg; while(PeekMessage(out msg,IntPtr.Zero,0,0,1)) {}
                    if (timer.ElapsedMilliseconds>35000) throw new Exception("Launcher probe timed out; inspect its process before retrying");
                    System.Threading.Thread.Sleep(5);
                }
                MSG last; while(PeekMessage(out last,IntPtr.Zero,0,0,1)) {}
                exitCode=process.ExitCode;
            }
        } finally { UnhookWinEvent(hook); GC.KeepAlive(callback); ExternalEvents=external.ToArray(); }
        return own.ToArray();
    }
}
