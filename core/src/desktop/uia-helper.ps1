# The built-in UI Automation driver (D71, D78). One JSON request per stdin line, one JSON reply per stdout line:
# {"id":1,"op":"info","hwnd":1234} -> {"id":1,"result":{...}} or {"id":1,"error":"..."}. Ops and results are in
# contracts/desktop-tools.md. Never calls SendInput, mouse_event or SetCursorPos, so the pointer never moves.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Web.Extensions, WindowsBase

Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, System.Drawing, System.Web.Extensions, WindowsBase -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace TroopUia {
  public static class Native {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO { public int cbSize; public int flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, StringBuilder l);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] public static extern bool GetProcessTimes(IntPtr h, out long create, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder s, ref uint n);
    [DllImport("advapi32.dll")] public static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
    [DllImport("advapi32.dll")] public static extern bool GetTokenInformation(IntPtr token, int cls, out int value, int len, out int ret);
  }

  public static class Helper {
    const uint GA_ROOT = 2, GW_OWNER = 4, PW_RENDERFULLCONTENT = 2;
    const uint WM_SETTEXT = 0x000C, WM_GETTEXT = 0x000D, WM_GETTEXTLENGTH = 0x000E, WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_CHAR = 0x0102;
    const uint WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105, WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202, BM_CLICK = 0x00F5;
    const int MAX_SIDE = 1568, MAX_BASE64 = 900000;
    static readonly JavaScriptSerializer J = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    static readonly Dictionary<long, Dictionary<string, AutomationElement>> Refs = new Dictionary<long, Dictionary<string, AutomationElement>>();

    public static void Init() {
      try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { Native.SetProcessDPIAware(); } catch { } }
    }

    public static string Handle(string line) {
      object id = null;
      try {
        var req = J.Deserialize<Dictionary<string, object>>(line);
        if (req.ContainsKey("id")) id = req["id"];
        object result = Dispatch(Str(req, "op"), req);
        return J.Serialize(new Dictionary<string, object> { { "id", id }, { "result", result } });
      } catch (Exception e) {
        Exception inner = e;
        while (inner.InnerException != null) inner = inner.InnerException;
        return J.Serialize(new Dictionary<string, object> { { "id", id }, { "error", inner.Message } });
      }
    }

    // the control an input reaches must still be the one the core approved, checked in the op that sends it
    static void Expect(long hwnd, AutomationElement e, bool hidden, Dictionary<string, object> r) {
      if (Num(r, "check") == 0) return;
      if ((bool)((Dictionary<string, object>)Info(new IntPtr(hwnd)))["file_dialog"] != (Num(r, "file_dialog") != 0)) throw new Exception("control changed");
      var c = e == null ? null : ControlOf(e);
      bool password = e != null && e.Current.IsPassword;
      if (hidden != (Num(r, "hidden") != 0) || password != (Num(r, "password") != 0) || (c == null ? "" : (string)c["name"]) != Str(r, "name")
        || (c == null ? "" : (string)c["automation_id"]) != Str(r, "automation_id") || (c == null ? "" : (string)c["role"]) != Str(r, "role")) throw new Exception("control changed");
    }

    static string Str(Dictionary<string, object> r, string k) { return r.ContainsKey(k) && r[k] != null ? Convert.ToString(r[k]) : ""; }
    static long Num(Dictionary<string, object> r, string k) { return r.ContainsKey(k) && r[k] != null ? Convert.ToInt64(r[k]) : 0; }

    static object Dispatch(string op, Dictionary<string, object> r) {
      long hwnd = Num(r, "hwnd");
      if (Num(r, "pid") != 0) { uint owner; Native.GetWindowThreadProcessId(new IntPtr(hwnd), out owner); if (owner != Num(r, "pid")) throw new Exception("window not granted"); }
      switch (op) {
        case "list": return new Dictionary<string, object> { { "windows", List() } };
        case "info": return Info(new IntPtr(hwnd));
        case "snapshot": return Snapshot(hwnd, (int)Math.Max(1, Num(r, "max_nodes")));
        case "describe": return Describe(hwnd, Str(r, "ref"));
        case "screenshot": return Screenshot(new IntPtr(hwnd));
        case "set_text": Expect(hwnd, Find(hwnd, Str(r, "ref")), false, r); return SetText(hwnd, Str(r, "ref"), Str(r, "value"));
        case "click": Expect(hwnd, Find(hwnd, Str(r, "ref")), false, r); return Click(hwnd, Str(r, "ref"));
        case "key": {
          bool hidden; IntPtr target; var f = Focused(new IntPtr(hwnd), out hidden, out target);
          Expect(hwnd, f, hidden, r);
          return Key(target, Str(r, "keys"));
        }
        case "scroll": if (Str(r, "ref").Length > 0) Expect(hwnd, Find(hwnd, Str(r, "ref")), false, r); return Scroll(hwnd, Str(r, "ref"), Num(r, "dy"));
        case "find_text": return FindText(new IntPtr(hwnd), Str(r, "text"));
        case "value": return new Dictionary<string, object> { { "value", ValueOf(Find(hwnd, Str(r, "ref"))) } };
        case "probe": {
          Native.POINT p; Native.GetCursorPos(out p);
          return new Dictionary<string, object> { { "cursor", new[] { p.X, p.Y } }, { "foreground", Native.GetForegroundWindow().ToInt64() } };
        }
        default: throw new Exception("unknown op " + op);
      }
    }

    static string ClassOf(IntPtr h) { var s = new StringBuilder(256); Native.GetClassName(h, s, 256); return s.ToString(); }
    static string TitleOf(IntPtr h) { var s = new StringBuilder(512); Native.GetWindowText(h, s, 512); return s.ToString(); }
    static int[] RectOf(IntPtr h) { Native.RECT r; Native.GetWindowRect(h, out r); return new[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top }; }

    static List<object> List() {
      var found = new List<IntPtr>();
      Native.EnumWindows((h, l) => { if (Native.IsWindowVisible(h)) found.Add(h); return true; }, IntPtr.Zero);
      return found.Select(h => (object)Info(h)).ToList();
    }

    /** Process start (UTC, ISO), exe name and elevation; a process whose token cannot be read counts as elevated. */
    static void ProcessFacts(uint pid, out string start, out string exe, out bool elevated) {
      start = ""; exe = ""; elevated = true;
      IntPtr p = Native.OpenProcess(0x1000, false, pid);
      if (p == IntPtr.Zero) return;
      try {
        long create, exit, kernel, user;
        if (Native.GetProcessTimes(p, out create, out exit, out kernel, out user)) start = DateTime.FromFileTimeUtc(create).ToString("o");
        var s = new StringBuilder(1024); uint n = 1024;
        if (Native.QueryFullProcessImageName(p, 0, s, ref n)) exe = Path.GetFileName(s.ToString());
        IntPtr token;
        if (Native.OpenProcessToken(p, 0x0008, out token)) {
          int value, ret;
          if (Native.GetTokenInformation(token, 20, out value, 4, out ret)) elevated = value != 0;
          Native.CloseHandle(token);
        }
      } finally { Native.CloseHandle(p); }
    }

    static bool FileDialog(IntPtr root, string cls, string title) {
      if (cls != "#32770") return false;
      string t = title.ToLowerInvariant();
      if (t == "save as" || t == "open" || t == "save" || t.StartsWith("save as") || t.StartsWith("open ")) return true;
      bool list = false;
      Native.EnumChildWindows(root, (h, l) => { string c = ClassOf(h); if (c == "SHELLDLL_DefView" || c == "DUIViewWndClassName" || c == "DirectUIHWND") { list = true; return false; } return true; }, IntPtr.Zero);
      return list;
    }

    static Dictionary<string, object> Info(IntPtr h) {
      var o = new Dictionary<string, object>();
      o["hwnd"] = h.ToInt64();
      if (h == IntPtr.Zero || !Native.IsWindow(h)) {
        o["alive"] = false; o["root"] = h.ToInt64(); o["pid"] = 0; o["process_start"] = ""; o["exe"] = ""; o["title"] = ""; o["class"] = "";
        o["owner_chain"] = new long[0]; o["file_dialog"] = false; o["elevated"] = false; o["rect"] = new[] { 0, 0, 0, 0 }; o["minimized"] = false;
        return o;
      }
      IntPtr root = Native.GetAncestor(h, GA_ROOT);
      if (root == IntPtr.Zero) root = h;
      uint pid; Native.GetWindowThreadProcessId(root, out pid);
      string start, exe; bool elevated;
      ProcessFacts(pid, out start, out exe, out elevated);
      var chain = new List<long>();
      for (IntPtr w = Native.GetWindow(root, GW_OWNER); w != IntPtr.Zero && chain.Count < 16; w = Native.GetWindow(w, GW_OWNER)) chain.Add(w.ToInt64());
      string cls = ClassOf(root), title = TitleOf(root);
      o["alive"] = true; o["root"] = root.ToInt64(); o["pid"] = (long)pid; o["process_start"] = start; o["exe"] = exe; o["title"] = title;
      o["class"] = cls; o["owner_chain"] = chain; o["file_dialog"] = FileDialog(root, cls, title); o["elevated"] = elevated;
      o["rect"] = RectOf(root); o["minimized"] = Native.IsIconic(root);
      return o;
    }

    static string Role(AutomationElement e) {
      string n = e.Current.ControlType.ProgrammaticName;
      return n.StartsWith("ControlType.") ? n.Substring(12).ToLowerInvariant() : n.ToLowerInvariant();
    }

    static Dictionary<string, object> ControlOf(AutomationElement e) {
      return new Dictionary<string, object> { { "automation_id", e.Current.AutomationId ?? "" }, { "name", e.Current.Name ?? "" }, { "role", Role(e) } };
    }

    static object RectOfElement(AutomationElement e) {
      var r = e.Current.BoundingRectangle;
      if (r.IsEmpty) return null;
      return new[] { (int)r.X, (int)r.Y, (int)r.Width, (int)r.Height };
    }

    static string ValueOf(AutomationElement e) {
      object p;
      if (e.Current.IsPassword || !e.TryGetCurrentPattern(ValuePattern.Pattern, out p)) return null;
      return ((ValuePattern)p).Current.Value;
    }

    static List<KeyValuePair<int, AutomationElement>> Walk(AutomationElement top, int max) {
      var outList = new List<KeyValuePair<int, AutomationElement>>();
      var walker = TreeWalker.ControlViewWalker;
      var stack = new Stack<KeyValuePair<int, AutomationElement>>();
      stack.Push(new KeyValuePair<int, AutomationElement>(0, top));
      while (stack.Count > 0 && outList.Count < max) {
        var cur = stack.Pop();
        outList.Add(cur);
        var kids = new List<AutomationElement>();
        try { for (var c = walker.GetFirstChild(cur.Value); c != null; c = walker.GetNextSibling(c)) kids.Add(c); } catch { }
        for (int i = kids.Count - 1; i >= 0; i--) stack.Push(new KeyValuePair<int, AutomationElement>(cur.Key + 1, kids[i]));
      }
      return outList;
    }

    static object Snapshot(long hwnd, int max) {
      var top = AutomationElement.FromHandle(new IntPtr(hwnd));
      var nodes = Walk(top, max);
      if (nodes.Count < 20) { Thread.Sleep(2000); nodes = Walk(top, max); }
      var map = new Dictionary<string, AutomationElement>();
      var sb = new StringBuilder();
      int n = 0;
      foreach (var kv in nodes) {
        var e = kv.Value;
        string id = "e" + (++n);
        map[id] = e;
        string name, aid, val = null; bool pw;
        try { name = e.Current.Name ?? ""; aid = e.Current.AutomationId ?? ""; pw = e.Current.IsPassword; val = ValueOf(e); } catch { continue; }
        sb.Append(new string(' ', kv.Key * 2)).Append(Role(e));
        if (name.Length > 0) sb.Append(" \"").Append(name.Length > 200 ? name.Substring(0, 200) : name).Append('"');
        if (aid.Length > 0) sb.Append(" #").Append(aid);
        if (pw) sb.Append(" password");
        if (!string.IsNullOrEmpty(val)) sb.Append(" value=\"").Append((val.Length > 200 ? val.Substring(0, 200) + "..." : val).Replace("\r", " ").Replace("\n", " ")).Append('"');
        sb.Append(" [ref=").Append(id).Append("]\n");
      }
      Refs[hwnd] = map;
      return new Dictionary<string, object> { { "text", sb.ToString() }, { "nodes", n } };
    }

    static AutomationElement Find(long hwnd, string reference) {
      Dictionary<string, AutomationElement> map;
      AutomationElement e;
      if (!Refs.TryGetValue(hwnd, out map) || !map.TryGetValue(reference, out e)) throw new Exception("unknown ref " + reference + "; take a new snapshot");
      var w = e;
      try { while (w != null && w.Current.NativeWindowHandle == 0) w = TreeWalker.RawViewWalker.GetParent(w); } catch { w = null; }
      if (w == null || Native.GetAncestor(new IntPtr(w.Current.NativeWindowHandle), GA_ROOT) != Native.GetAncestor(new IntPtr(hwnd), GA_ROOT)) throw new Exception("ref " + reference + " is no longer in this window; take a new snapshot");
      return e;
    }

    // hidden: the control that gets a key is unknown (no focus HWND in this window, or a container HWND while global focus is elsewhere)
    static AutomationElement Focused(IntPtr hwnd, out bool hidden) { IntPtr target; return Focused(hwnd, out hidden, out target); }

    // target: the HWND a key for this window is posted to
    static AutomationElement Focused(IntPtr hwnd, out bool hidden, out IntPtr target) {
      hidden = true;
      target = hwnd;
      uint pid; uint tid = Native.GetWindowThreadProcessId(hwnd, out pid);
      var gti = new Native.GUITHREADINFO(); gti.cbSize = Marshal.SizeOf(gti);
      if (!Native.GetGUIThreadInfo(tid, ref gti) || gti.hwndFocus == IntPtr.Zero) return null;
      if (Native.GetAncestor(gti.hwndFocus, GA_ROOT) != Native.GetAncestor(hwnd, GA_ROOT)) return null;
      hidden = false;
      target = gti.hwndFocus;
      try {
        var f = AutomationElement.FocusedElement;
        var e = f;
        while (e != null && e.Current.NativeWindowHandle == 0) e = TreeWalker.RawViewWalker.GetParent(e);
        if (e != null && new IntPtr(e.Current.NativeWindowHandle) == gti.hwndFocus) return f;
      } catch {}
      try {
        var h = AutomationElement.FromHandle(gti.hwndFocus);
        var t = h.Current.ControlType;
        hidden = t == ControlType.Pane || t == ControlType.Window || t == ControlType.Document || t == ControlType.Custom || t == ControlType.Group || TreeWalker.ControlViewWalker.GetFirstChild(h) != null;
        return h;
      } catch { hidden = true; return null; }
    }

    static object Describe(long hwnd, string reference) {
      bool hidden = false;
      AutomationElement e = reference.Length > 0 ? Find(hwnd, reference) : Focused(new IntPtr(hwnd), out hidden);
      if (e == null) return new Dictionary<string, object> { { "control", null }, { "password", false }, { "hidden", hidden }, { "rect", RectOf(new IntPtr(hwnd)) } };
      return new Dictionary<string, object> { { "control", ControlOf(e) }, { "password", e.Current.IsPassword }, { "hidden", hidden }, { "rect", RectOfElement(e) } };
    }

    static object Screenshot(IntPtr h) {
      var rc = RectOf(h);
      if (rc[2] <= 0 || rc[3] <= 0) throw new Exception("the window has no size (minimised?)");
      using (var bmp = new Bitmap(rc[2], rc[3])) {
        using (var g = Graphics.FromImage(bmp)) {
          IntPtr hdc = g.GetHdc();
          try { Native.PrintWindow(h, hdc, PW_RENDERFULLCONTENT); } finally { g.ReleaseHdc(hdc); }
        }
        double scale = Math.Min(1.0, (double)MAX_SIDE / Math.Max(rc[2], rc[3]));
        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
        long[] qualities = { 80L, 60L, 45L };
        for (int attempt = 0; ; attempt++) {
          int w = Math.Max(1, (int)(rc[2] * scale)), hh = Math.Max(1, (int)(rc[3] * scale));
          using (var outBmp = new Bitmap(w, hh)) {
            using (var g = Graphics.FromImage(outBmp)) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(bmp, 0, 0, w, hh); }
            var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, qualities[Math.Min(attempt, qualities.Length - 1)]);
            using (var ms = new MemoryStream()) {
              outBmp.Save(ms, codec, ps);
              string data = Convert.ToBase64String(ms.ToArray());
              // the reply travels the core pipe, whose lines stop at 1 MiB
              if (data.Length <= MAX_BASE64 || w <= 64) return new Dictionary<string, object> { { "data_base64", data }, { "mime", "image/jpeg" }, { "width", w }, { "height", hh } };
            }
          }
          if (attempt >= qualities.Length - 1) scale *= 0.75;
        }
      }
    }

    /** Gives the foreground back after a pattern action moved it; returns whether it is back. */
    static bool ReturnFocus(IntPtr before) {
      if (before == IntPtr.Zero || Native.GetForegroundWindow() == before) return true;
      Native.SetForegroundWindow(before);
      Thread.Sleep(30);
      return Native.GetForegroundWindow() == before;
    }

    static Dictionary<string, object> Result(bool confirmed, IntPtr before, bool patternUsed) {
      var o = new Dictionary<string, object> { { "status", confirmed ? "confirmed" : "unverifiable" } };
      if (patternUsed) o["focus_returned"] = ReturnFocus(before);
      return o;
    }

    static string WindowText(IntPtr h) {
      int n = Native.SendMessage(h, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero).ToInt32();
      var s = new StringBuilder(n + 1);
      Native.SendMessage(h, WM_GETTEXT, new IntPtr(n + 1), s);
      return s.ToString();
    }

    static object SetText(long hwnd, string reference, string value) {
      var e = Find(hwnd, reference);
      IntPtr before = Native.GetForegroundWindow();
      IntPtr own = new IntPtr(e.Current.NativeWindowHandle);
      if (own != IntPtr.Zero && own != Native.GetAncestor(own, GA_ROOT)) {
        Native.SendMessage(own, WM_SETTEXT, IntPtr.Zero, value);
        if (WindowText(own) == value) return Result(true, before, false);
      }
      object p;
      if (!e.TryGetCurrentPattern(ValuePattern.Pattern, out p)) throw new Exception("this control takes no text");
      ((ValuePattern)p).SetValue(value);
      string now = null;
      try { now = ((ValuePattern)p).Current.Value; } catch { }
      return Result(now == value, before, true);
    }

    static object Click(long hwnd, string reference) {
      var e = Find(hwnd, reference);
      IntPtr before = Native.GetForegroundWindow();
      IntPtr own = new IntPtr(e.Current.NativeWindowHandle);
      if (own != IntPtr.Zero && own != Native.GetAncestor(own, GA_ROOT)) {
        if (ClassOf(own).IndexOf("Button", StringComparison.OrdinalIgnoreCase) >= 0) {
          Native.PostMessage(own, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
        } else {
          var rc = RectOf(own);
          var pt = new Native.POINT { X = rc[0] + rc[2] / 2, Y = rc[1] + rc[3] / 2 };
          Native.ScreenToClient(own, ref pt);
          IntPtr lp = new IntPtr((pt.Y << 16) | (pt.X & 0xFFFF));
          Native.PostMessage(own, WM_LBUTTONDOWN, new IntPtr(1), lp);
          Native.PostMessage(own, WM_LBUTTONUP, IntPtr.Zero, lp);
        }
        return Result(false, before, false);
      }
      object p;
      if (e.TryGetCurrentPattern(InvokePattern.Pattern, out p)) { ((InvokePattern)p).Invoke(); return Result(false, before, true); }
      if (e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) {
        var t = (TogglePattern)p; var was = t.Current.ToggleState; t.Toggle();
        return Result(t.Current.ToggleState != was, before, true);
      }
      if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) {
        var s = (SelectionItemPattern)p; s.Select();
        return Result(s.Current.IsSelected, before, true);
      }
      if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) {
        var x = (ExpandCollapsePattern)p; var was = x.Current.ExpandCollapseState;
        if (was == ExpandCollapseState.Collapsed) x.Expand(); else x.Collapse();
        return Result(x.Current.ExpandCollapseState != was, before, true);
      }
      throw new Exception("this control has no click action UI Automation can use");
    }

    static readonly Dictionary<string, int> Keys = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) {
      { "enter", 0x0D }, { "return", 0x0D }, { "tab", 0x09 }, { "escape", 0x1B }, { "esc", 0x1B }, { "backspace", 0x08 }, { "delete", 0x2E },
      { "space", 0x20 }, { "left", 0x25 }, { "up", 0x26 }, { "right", 0x27 }, { "down", 0x28 }, { "arrowleft", 0x25 }, { "arrowup", 0x26 },
      { "arrowright", 0x27 }, { "arrowdown", 0x28 }, { "home", 0x24 }, { "end", 0x23 }, { "pageup", 0x21 }, { "pagedown", 0x22 }, { "insert", 0x2D },
      { "control", 0x11 }, { "ctrl", 0x11 }, { "shift", 0x10 }, { "alt", 0x12 },
    };

    static IntPtr KeyLParam(int vk, bool up, bool sys) {
      long scan = Native.MapVirtualKey((uint)vk, 0);
      long lp = 1 | (scan << 16);
      if (sys) lp |= 1L << 29;
      if (up) lp |= (1L << 30) | (1L << 31);
      return new IntPtr(unchecked((int)lp));
    }

    static object Key(IntPtr target, string keys) {
      var parts = keys.Split('+').Select(k => k.Trim()).Where(k => k.Length > 0).ToList();
      if (parts.Count == 0) throw new Exception("keys is required");
      foreach (var m in parts.Take(parts.Count - 1)) if (!Keys.ContainsKey(m) || !(Keys[m] == 0x10 || Keys[m] == 0x11 || Keys[m] == 0x12)) throw new Exception("unknown modifier " + m + "; use Control, Shift or Alt");
      var mods = parts.Take(parts.Count - 1).Select(m => Keys[m]).ToList();
      bool alt = mods.Contains(0x12), ctrl = mods.Contains(0x11);
      string last = parts[parts.Count - 1];
      int vk; char ch = '\0';
      if (Keys.TryGetValue(last, out vk)) { if (vk == 0x0D) ch = '\r'; else if (vk == 0x09) ch = '\t'; else if (vk == 0x08) ch = '\b'; else if (vk == 0x20) ch = ' '; else if (vk == 0x1B) ch = (char)0x1B; }
      else if (last.Length > 1 && (last[0] == 'F' || last[0] == 'f') && int.TryParse(last.Substring(1), out vk) && vk >= 1 && vk <= 24) vk = 0x6F + vk;
      else if (last.Length == 1) { ch = last[0]; vk = char.ToUpperInvariant(ch); if (!char.IsLetterOrDigit(ch)) vk = 0; }
      else throw new Exception("unknown key " + last);
      uint down = alt ? WM_SYSKEYDOWN : WM_KEYDOWN, upMsg = alt ? WM_SYSKEYUP : WM_KEYUP;
      foreach (var m in mods) Native.PostMessage(target, down, new IntPtr(m), KeyLParam(m, false, alt));
      if (vk != 0) Native.PostMessage(target, down, new IntPtr(vk), KeyLParam(vk, false, alt));
      if (ch != '\0' && !alt && !ctrl) Native.PostMessage(target, WM_CHAR, new IntPtr(ch), KeyLParam(vk, false, false));
      if (vk != 0) Native.PostMessage(target, upMsg, new IntPtr(vk), KeyLParam(vk, true, alt));
      for (int i = mods.Count - 1; i >= 0; i--) Native.PostMessage(target, upMsg, new IntPtr(mods[i]), KeyLParam(mods[i], true, alt));
      return new Dictionary<string, object> { { "status", "unverifiable" } };
    }

    static object Scroll(long hwnd, string reference, long dy) {
      AutomationElement e = reference.Length > 0 ? Find(hwnd, reference) : AutomationElement.FromHandle(new IntPtr(hwnd)).FindFirst(TreeScope.Subtree, new PropertyCondition(AutomationElement.IsScrollPatternAvailableProperty, true));
      object p;
      if (e == null || !e.TryGetCurrentPattern(ScrollPattern.Pattern, out p)) throw new Exception("nothing here scrolls through UI Automation");
      var s = (ScrollPattern)p;
      double was = s.Current.VerticalScrollPercent;
      IntPtr before = Native.GetForegroundWindow();
      int steps = (int)Math.Max(1, Math.Round(Math.Abs(dy) / 100.0));
      for (int i = 0; i < steps; i++) s.ScrollVertical(dy > 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement);
      return Result(s.Current.VerticalScrollPercent != was, before, true);
    }

    static object FindText(IntPtr hwnd, string text) {
      foreach (AutomationElement e in AutomationElement.FromHandle(hwnd).FindAll(TreeScope.Descendants, Condition.TrueCondition)) {
        try {
          if ((e.Current.Name ?? "").Contains(text)) return new Dictionary<string, object> { { "found", true } };
          string v = ValueOf(e);
          if (v != null && v.Contains(text)) return new Dictionary<string, object> { { "found", true } };
        } catch { }
      }
      return new Dictionary<string, object> { { "found", false } };
    }
  }
}
'@

[TroopUia.Helper]::Init()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  [Console]::Out.WriteLine([TroopUia.Helper]::Handle($line))
  [Console]::Out.Flush()
}
