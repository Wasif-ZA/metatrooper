import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import { until } from './helpers.ts';

const SCRIPT = String.raw`
param([string]$CommandFile)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class PostedFixture {
  public delegate IntPtr Proc(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct WC {
    public uint style; public Proc proc; public int cls,wnd; public IntPtr instance,icon,cursor,brush; public string menu,name;
  }
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref WC c);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(int ex,string cls,string name,int style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetFocus();
  [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  static Proc proc=Handle;
  static IntPtr Handle(IntPtr h,uint m,IntPtr w,IntPtr l) {
    if(m==0x100 || m==0x101 || m==0x102 || m==0x104 || m==0x105) { Console.WriteLine("EV key "+h.ToInt64()); Console.Out.Flush(); }
    return DefWindowProc(h,m,w,l);
  }
  public static IntPtr Child(IntPtr parent,string cls,int y) {
    WC c=new WC(); c.proc=proc; c.name=cls; RegisterClass(ref c);
    return CreateWindowEx(0,cls,cls,0x50010000,20,y,200,30,parent,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
  }
}
'@
$f=New-Object System.Windows.Forms.Form; $f.Text='Overnight refusal fixture'; $f.StartPosition='Manual'; $f.Location=New-Object System.Drawing.Point(60,60); $f.Size=New-Object System.Drawing.Size(500,400)
$l=New-Object System.Windows.Forms.Label; $l.Text='Refusal label'; $l.AccessibleName='Refusal label'; $l.Location=New-Object System.Drawing.Point(10,10); $l.Add_Click({ [Console]::WriteLine('EV label'); [Console]::Out.Flush() }); $f.Controls.Add($l)
$handles=@{}
foreach($cls in @('Chrome_WidgetWin_1','Chrome_RenderWidgetHostHWND','Windows.UI.Core.CoreWindow')) { $handles[$cls]=[PostedFixture]::Child($f.Handle,$cls,80+40*$handles.Count) }
$cover=New-Object System.Windows.Forms.Form; $cover.Text='Overnight refusal cover'; $cover.StartPosition='Manual'; $cover.Location=$f.Location; $cover.Size=$f.Size; $cover.TopMost=$true
$script:last=0
$timer=New-Object System.Windows.Forms.Timer; $timer.Interval=50
$timer.Add_Tick({
  if(Test-Path -LiteralPath $CommandFile) {
    try { $c=Get-Content -Raw -LiteralPath $CommandFile | ConvertFrom-Json } catch { return }
    if($c.id -ne $script:last) {
      $script:last=$c.id
      if($c.action -eq 'focus') { $f.Activate(); [PostedFixture]::SetFocus($handles[$c.value]) | Out-Null; if([PostedFixture]::GetFocus() -ne $handles[$c.value]) { return } }
      if($c.action -eq 'cover') { $cover.Show(); $cover.BringToFront() }
      if($c.action -eq 'uncover') { $cover.Hide() }
      [Console]::WriteLine('READY '+$c.id); [Console]::Out.Flush()
    }
  }
})
$f.Add_Shown({ [Console]::WriteLine('HWND '+$f.Handle.ToInt64()); [Console]::Out.Flush(); $timer.Start() })
[System.Windows.Forms.Application]::Run($f)
`;
const PS=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass'];
const T={skip:process.platform!=='win32',timeout:30000};
const kids: ChildProcess[]=[];
const output:string[]=[];
let dir:string,hwnd:number,ask:(r:object)=>Promise<any>,ui:object;
let seq=0;
async function command(action:string,value='') {
  const id=++seq;
  writeFileSync(join(dir,'command.json'),JSON.stringify({id,action,value}));
  await until(()=>output.includes('READY '+id),10000);
}
before(async()=>{
  if(process.platform!=='win32') return;
  dir=mkdtempSync(join(tmpdir(),'overnight-refusal-'));
  writeFileSync(join(dir,'fixture.ps1'),SCRIPT);
  const f=spawn('powershell.exe',[...PS,'-STA','-File',join(dir,'fixture.ps1'),'-CommandFile',join(dir,'command.json')],{stdio:['ignore','pipe','pipe']});
  kids.push(f);
  let errors=''; f.stderr!.on('data',b=>{errors+=b;});
  readline.createInterface({input:f.stdout!}).on('line',l=>output.push(l));
  const line=await until(()=>output.find(l=>l.startsWith('HWND ')) || (f.exitCode!==null && assert.fail(errors)),20000);
  hwnd=Number(line.slice(5));
  const h=spawn('powershell.exe',[...PS,'-File',join(import.meta.dirname,'../src/desktop/uia-helper.ps1')],{stdio:['pipe','pipe','pipe']});
  kids.push(h);
  let helperErrors=''; h.stderr!.on('data', b => { helperErrors += b; });
  const replies=new Map<number,any>(); let n=0;
  readline.createInterface({input:h.stdout!}).on('line',l=>{const r=JSON.parse(l);replies.set(r.id,r);});
  ask=async r=>{const id=++n;h.stdin!.write(JSON.stringify({id,...r})+'\n');return until(()=>replies.get(id) || (h.exitCode !== null && assert.fail(helperErrors)),15000);};
  const r=await ask({op:'process',process:h.pid});
  ui={ui_pid:h.pid,ui_start:r.result.process_start};
});
after(async()=>{
  for(const p of kids) if(p.exitCode===null) {const exited=once(p,'exit');p.kill();await exited;}
  if(dir) rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
});

test('overnight refusal: covered WinForms Label receives no click',T,async()=>{
  const snap=await ask({op:'snapshot',hwnd,max_nodes:400});
  assert.equal(snap.error,undefined);
  const line=snap.result.text.split(/\r?\n/).find((l:string)=>l.includes('"Refusal label"'));
  assert.ok(line);
  const ref=/\[ref=(e\d+)\]/.exec(line)![1];
  await command('cover');
  try {
    const start=output.length;
    const r=await ask({op:'click',hwnd,ref,...ui});
    assert.match(String(r.error?.message??r.error),/^background_unavailable:.*nothing was sent$/);
    await new Promise(r=>setTimeout(r,300));
    assert.equal(output.slice(start).includes('EV label'),false);
  } finally {await command('uncover');}
});

for(const [cls,keys] of [
  ['Chrome_WidgetWin_1','Alt+g'],['Chrome_RenderWidgetHostHWND','Alt+g'],
  ...['Escape','Delete','Backspace','Enter','Down','Alt+g'].map(k=>['Windows.UI.Core.CoreWindow',k]),
]) test('overnight refusal: '+cls+' '+keys+' posts nothing',T,async()=>{
  await command('focus',cls);
  const controlStart=output.length;
  const control=await ask({op:'key',hwnd,keys:'x',...ui});
  assert.equal(control.error,undefined);
  await until(()=>output.slice(controlStart).some(l=>l.startsWith('EV key')),2000);
  const start=output.length;
  const r=await ask({op:'key',hwnd,keys,...ui});
  assert.match(String(r.error?.message??r.error),/^background_unavailable:.*nothing was sent$/);
  await new Promise(r=>setTimeout(r,250));
  assert.deepEqual(output.slice(start).filter(l=>l.startsWith('EV key')),[]);
});
