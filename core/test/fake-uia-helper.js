// A stand-in for core/src/desktop/uia-helper.ps1: same line protocol, windows read from FAKE_UIA_STATE on every
// request, and every input appended to FAKE_UIA_LOG as one JSON line.
import fs from 'node:fs';
import readline from 'node:readline';

const delay = Number(process.env.FAKE_UIA_DELAY_MS || 0);
const state = () => JSON.parse(fs.readFileSync(process.env.FAKE_UIA_STATE, 'utf8'));

function chain(w, all) {
  const out = [];
  for (let o = w.owner; o; o = all.find((x) => x.hwnd === o)?.owner) out.push(o);
  return out;
}

function info(w, all) {
  return {
    alive: true, hwnd: w.hwnd, root: w.hwnd, pid: w.pid, process_start: w.process_start, exe: w.exe, title: w.title,
    class: w.class ?? '', owner_chain: chain(w, all), file_dialog: Boolean(w.file_dialog), elevated: Boolean(w.elevated),
    rect: w.rect ?? [0, 0, 800, 600], minimized: false,
  };
}

function control(w, ref) {
  const c = (w.controls ?? [])[Number(String(ref).slice(1)) - 1];
  if (!c) throw new Error(`unknown ref ${ref}; take a new snapshot`);
  return c;
}

const log = (entry) => fs.appendFileSync(process.env.FAKE_UIA_LOG, JSON.stringify({ ...entry, at: Date.now() }) + '\n');

function handle(req) {
  const all = state().windows;
  const w = req.hwnd ? all.find((x) => x.hwnd === req.hwnd) : null;
  switch (req.op) {
    case 'list': return { windows: all.map((x) => info(x, all)) };
    case 'info': return w ? info(w, all) : { alive: false, hwnd: req.hwnd, root: req.hwnd, pid: 0, process_start: '', exe: '', title: '', class: '', owner_chain: [], file_dialog: false, elevated: false, rect: [0, 0, 0, 0], minimized: false };
    case 'describe': {
      if (!w) throw new Error('window is gone');
      if (!req.ref) return { control: null, password: false, rect: w.rect ?? null };
      const c = control(w, req.ref);
      return { control: { automation_id: c.automation_id ?? '', name: c.name ?? '', role: c.role ?? '' }, password: Boolean(c.password), rect: [10, 10, 50, 20] };
    }
    case 'snapshot': return { text: (w?.controls ?? []).map((c, i) => `${c.role} "${c.name}" [ref=e${i + 1}]`).join('\n'), nodes: (w?.controls ?? []).length };
    case 'screenshot': return { data_base64: '/9j/', mime: 'image/jpeg', width: 1, height: 1 };
    case 'find_text': return { found: (w?.controls ?? []).some((c) => String(c.name).includes(req.text)) };
    case 'set_text': control(w, req.ref); log({ op: 'set_text', hwnd: req.hwnd, ref: req.ref, value: req.value }); return { status: 'confirmed' };
    case 'click': case 'key': case 'scroll': log({ op: req.op, hwnd: req.hwnd, ref: req.ref, keys: req.keys }); return { status: 'confirmed' };
    default: throw new Error(`unknown op ${req.op}`);
  }
}

let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  queue = queue.then(async () => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try { process.stdout.write(JSON.stringify({ id: req.id, result: handle(req) }) + '\n'); }
    catch (e) { process.stdout.write(JSON.stringify({ id: req.id, error: e.message }) + '\n'); }
  });
});
