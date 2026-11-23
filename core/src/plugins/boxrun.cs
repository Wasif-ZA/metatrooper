// Runs one program inside a Windows AppContainer (M8-14a): boxrun <name> <net 0|1> <grants-file> <program> <cmdline>
// grants-file lines: "r <dir>" or "w <dir>". Only the three std handles are inherited. Every Win32 call is checked and a
// failure exits 121 before the program can start unconfined. The exit code is the child's; 120-122 are boxrun's own.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

static class BoxRun {
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string desc, IntPtr caps, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool AllocateAndInitializeSid(byte[] auth, byte count, uint a0, uint a1, uint a2, uint a3, uint a4, uint a5, uint a6, uint a7, out IntPtr sid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr val, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr p, uint code);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSidToStringSid(IntPtr sid, out string s);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string r, d, t; public int x, y, w, h, cx, cy, fill, flags; public short show, r2; public IntPtr r3, hIn, hOut, hErr; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO si; public IntPtr attrs; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr sid; public uint attrs; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr acSid; public IntPtr caps; public uint count; public uint reserved; }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long a, b; public uint flags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION basic; public IO_COUNTERS io; public UIntPtr a, b, c, d; }

  const uint PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x20002;
  const uint PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x20009;

  static int Fail(string what) { Console.Error.WriteLine("boxrun: " + what + " failed (" + Marshal.GetLastWin32Error() + "); nothing was started"); return 121; }

  static int Main(string[] a) {
    if (a.Length != 5) { Console.Error.WriteLine("usage: boxrun <name> <net 0|1> <grants-file> <program> <cmdline>"); return 120; }
    IntPtr sid;
    int hr = CreateAppContainerProfile(a[0], a[0], "cc plugin sandbox", IntPtr.Zero, 0, out sid);
    if (hr != 0 && DeriveAppContainerSidFromAppContainerName(a[0], out sid) != 0) { Console.Error.WriteLine("boxrun: no appcontainer profile: " + hr.ToString("x")); return 121; }
    string sidText;
    if (!ConvertSidToStringSid(sid, out sidText)) return Fail("ConvertSidToStringSid");
    var who = new SecurityIdentifier(sidText);
    try {
      foreach (var line in File.ReadAllLines(a[2])) {
        if (line.Length < 3) continue;
        if (line[1] != ' ' || (line[0] != 'r' && line[0] != 'w')) { Console.Error.WriteLine("boxrun: bad grant line"); return 121; }
        var rights = line[0] == 'w' ? FileSystemRights.Modify : FileSystemRights.ReadAndExecute;
        var dir = new DirectoryInfo(line.Substring(2));
        var acl = dir.GetAccessControl();
        bool has = false;
        foreach (FileSystemAccessRule r in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
          if ((r.IdentityReference.Equals(who) || r.IdentityReference.Value == "S-1-15-2-1") && r.AccessControlType == AccessControlType.Allow && (r.FileSystemRights & rights) == rights && (r.InheritanceFlags & InheritanceFlags.ObjectInherit) != 0) has = true;
        if (has) continue;
        acl.AddAccessRule(new FileSystemAccessRule(who, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        dir.SetAccessControl(acl);
      }
    } catch (Exception e) { Console.Error.WriteLine("boxrun: could not grant a folder: " + e.Message); return 121; }

    var sc = new SECURITY_CAPABILITIES { acSid = sid };
    if (a[1] == "1") {
      IntPtr net; // S-1-15-3-1 internetClient
      if (!AllocateAndInitializeSid(new byte[] { 0, 0, 0, 0, 0, 15 }, 2, 3, 1, 0, 0, 0, 0, 0, 0, out net)) return Fail("AllocateAndInitializeSid");
      var caps = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES)));
      Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { sid = net, attrs = 4 }, caps, false);
      sc.caps = caps; sc.count = 1;
    }
    var scPtr = Marshal.AllocHGlobal(Marshal.SizeOf(sc)); Marshal.StructureToPtr(sc, scPtr, false);

    var handles = new List<IntPtr>();
    foreach (var n in new[] { -10, -11, -12 }) {
      var h = GetStdHandle(n);
      if (h != IntPtr.Zero && h != new IntPtr(-1) && !handles.Contains(h)) handles.Add(h);
    }
    var handleList = Marshal.AllocHGlobal(IntPtr.Size * Math.Max(1, handles.Count));
    for (int i = 0; i < handles.Count; i++) Marshal.WriteIntPtr(handleList, i * IntPtr.Size, handles[i]);
    int attrCount = handles.Count > 0 ? 2 : 1;

    IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, attrCount, 0, ref size);
    var list = Marshal.AllocHGlobal(size);
    if (!InitializeProcThreadAttributeList(list, attrCount, 0, ref size)) return Fail("InitializeProcThreadAttributeList");
    if (!UpdateProcThreadAttribute(list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, scPtr, (IntPtr)Marshal.SizeOf(sc), IntPtr.Zero, IntPtr.Zero)) return Fail("UpdateProcThreadAttribute(security capabilities)");
    if (handles.Count > 0 && !UpdateProcThreadAttribute(list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handleList, (IntPtr)(IntPtr.Size * handles.Count), IntPtr.Zero, IntPtr.Zero)) return Fail("UpdateProcThreadAttribute(handle list)");

    var si = new STARTUPINFOEX(); si.si.cb = Marshal.SizeOf(si); si.attrs = list;
    si.si.flags = 0x100; si.si.hIn = GetStdHandle(-10); si.si.hOut = GetStdHandle(-11); si.si.hErr = GetStdHandle(-12);
    PROCESS_INFORMATION pi;
    // EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT
    if (!CreateProcess(a[3], new StringBuilder(a[4], a[4].Length + 1), IntPtr.Zero, IntPtr.Zero, handles.Count > 0, 0x80000 | 0x4 | 0x400, IntPtr.Zero, Environment.CurrentDirectory, ref si, out pi)) {
      Console.Error.WriteLine("boxrun: could not start: " + Marshal.GetLastWin32Error()); return 122;
    }
    var job = CreateJobObject(IntPtr.Zero, null);
    var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); info.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE
    if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(info)) || !AssignProcessToJobObject(job, pi.hProcess)) {
      TerminateProcess(pi.hProcess, 121);
      return Fail("job object");
    }
    if (ResumeThread(pi.hThread) == 0xFFFFFFFF) { TerminateProcess(pi.hProcess, 121); return Fail("ResumeThread"); }
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    return (int)code;
  }
}
