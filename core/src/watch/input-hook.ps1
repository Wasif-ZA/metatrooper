# Input watcher helper (M6-22, D70). Prints one ASCII-only JSON line (non-ASCII as \uXXXX, so the console code page cannot mangle titles) per injected input event or UI Automation event; exits when stdin closes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class MtInputWatch {
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr w; public IntPtr l; public uint time; public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

  static readonly BlockingCollection<long[]> queue = new BlockingCollection<long[]>();
  static HookProc keyProc, mouseProc;
  static readonly string[] kinds = { "key", "mouse", "focus", "opened", "invoked" };

  static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }

  static long IdleMs() {
    var i = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
    return GetLastInputInfo(ref i) ? (long)unchecked((uint)Environment.TickCount - i.dwTime) : -1;
  }

  static IntPtr OnKey(int code, IntPtr w, IntPtr l) {
    if (code >= 0 && (Marshal.ReadInt32(l, 8) & 0x10) != 0) queue.Add(new long[] { 0, Now(), -1, GetForegroundWindow().ToInt64() });
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  static IntPtr OnMouse(int code, IntPtr w, IntPtr l) {
    if (code >= 0 && (Marshal.ReadInt32(l, 12) & 0x01) != 0) queue.Add(new long[] { 1, Now(), -1, GetForegroundWindow().ToInt64() });
    return CallNextHookEx(IntPtr.Zero, code, w, l);
  }

  static void OnUia(int kind, object sender) {
    long t = Now(), idle = IdleMs(), hwnd = 0;
    try {
      var el = sender as AutomationElement;
      for (int i = 0; el != null && hwnd == 0 && i < 30; i++) {
        hwnd = el.Current.NativeWindowHandle;
        if (hwnd == 0) el = TreeWalker.RawViewWalker.GetParent(el);
      }
    } catch { }
    hwnd = hwnd == 0 ? GetForegroundWindow().ToInt64() : GetAncestor(new IntPtr(hwnd), 2).ToInt64();
    queue.Add(new long[] { kind, t, idle, hwnd });
  }

  static string Json(string s) {
    var b = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < ' ' || c > '~') b.AppendFormat("\\u{0:x4}", (int)c);
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  public static int Run() {
    var hooked = new ManualResetEvent(false);
    bool ok = false;
    var hooks = new Thread(() => {
      keyProc = OnKey;
      mouseProc = OnMouse;
      var mod = GetModuleHandle(null);
      ok = SetWindowsHookEx(13, keyProc, mod, 0) != IntPtr.Zero && SetWindowsHookEx(14, mouseProc, mod, 0) != IntPtr.Zero;
      hooked.Set();
      MSG m;
      while (ok && GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessage(ref m); }
    });
    hooks.IsBackground = true;
    hooks.Start();
    hooked.WaitOne();
    if (!ok) { Console.Error.WriteLine("SetWindowsHookEx failed: " + Marshal.GetLastWin32Error()); return 2; }

    var subscribed = new ManualResetEvent(false);
    var uia = new Thread(() => {
      Automation.AddAutomationFocusChangedEventHandler((s, e) => OnUia(2, s));
      Automation.AddAutomationEventHandler(WindowPattern.WindowOpenedEvent, AutomationElement.RootElement, TreeScope.Subtree, (s, e) => OnUia(3, s));
      Automation.AddAutomationEventHandler(InvokePattern.InvokedEvent, AutomationElement.RootElement, TreeScope.Subtree, (s, e) => OnUia(4, s));
      subscribed.Set();
      Thread.Sleep(Timeout.Infinite);
    });
    uia.IsBackground = true;
    uia.SetApartmentState(ApartmentState.MTA);
    uia.Start();
    subscribed.WaitOne();

    var stdin = new Thread(() => { while (Console.In.Read() >= 0) { } Environment.Exit(0); });
    stdin.IsBackground = true;
    stdin.Start();

    var title = new StringBuilder(512);
    Console.Out.WriteLine("{\"ready\":true}");
    Console.Out.Flush();
    foreach (var e in queue.GetConsumingEnumerable()) {
      title.Length = 0;
      GetWindowText(new IntPtr(e[3]), title, title.Capacity);
      Console.Out.WriteLine("{\"kind\":\"" + kinds[e[0]] + "\",\"t\":" + e[1] + ",\"idle_ms\":" + e[2] + ",\"hwnd\":" + e[3] + ",\"title\":" + Json(title.ToString()) + "}");
      Console.Out.Flush();
    }
    return 0;
  }
}
'@
exit [MtInputWatch]::Run()
