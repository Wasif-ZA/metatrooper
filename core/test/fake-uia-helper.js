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
  const current = state();
  const all = current.windows;
  const w = req.hwnd ? all.find((x) => x.hwnd === req.hwnd) : null;
  if (req.pid !== undefined && req.pid !== w?.pid) throw new Error('window not granted');
  const changePid = (key) => {
    if (current[key] !== undefined && w) { w.pid = current[key]; delete current[key]; fs.writeFileSync(process.env.FAKE_UIA_STATE, JSON.stringify(current)); }
  };
  switch (req.op) {
    case 'process_id': return { pid: process.pid };
    case 'never_answer': return new Promise(() => {});
    case 'list': return { windows: all.map((x) => info(x, all)) };
    case 'info': if (w) { const result = info(w, all); changePid('after_info_pid'); return result; } return { alive: false, hwnd: req.hwnd, root: req.hwnd, pid: 0, process_start: '', exe: '', title: '', class: '', owner_chain: [], file_dialog: false, elevated: false, rect: [0, 0, 0, 0], minimized: false };
    case 'describe': {
      if (!w) throw new Error('window is gone');
      if (!req.ref) return { control: null, password: false, rect: w.rect ?? null };
      const c = control(w, req.ref);
      changePid('after_describe_pid');
      return { control: { automation_id: c.automation_id ?? '', name: c.name ?? '', role: c.role ?? '' }, password: Boolean(c.password), hidden: Boolean(c.hidden), rid: c.rid ?? '', rect: [10, 10, 50, 20] };
    }
    case 'snapshot': return { text: (w?.controls ?? []).map((c, i) => `${c.role} "${c.name}" [ref=e${i + 1}]`).join('\n'), nodes: (w?.controls ?? []).length };
    case 'screenshot': return { data_base64: '/9j/', mime: 'image/jpeg', width: 1, height: 1 };
    case 'find_text': return { found: (w?.controls ?? []).some((c) => String(c.name).includes(req.text)) };
    case 'set_text': control(w, req.ref); log({ ...req }); return { status: 'confirmed' };
    case 'click': case 'key': case 'scroll': log({ ...req }); return { status: 'confirmed' };
    default: throw new Error(`unknown op ${req.op}`);
  }
}

let queue = Promise.resolve();
const counts = {};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  queue = queue.then(async () => {
    const current = state();
    const count = counts[req.op] = (counts[req.op] ?? 0) + 1;
    if (current.request_log) fs.appendFileSync(current.request_log, JSON.stringify({ ...req, count, at: Date.now() }) + '\n');
    const wait = current.delay_op === req.op && (current.delay_at === undefined || current.delay_at === count) ? current.delay_ms : delay;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      if (current.error_op === req.op && (current.error_at === undefined || current.error_at === count)) throw new Error('control changed');
      process.stdout.write(JSON.stringify({ id: req.id, result: await handle(req) }) + '\n'); }
    catch (e) { process.stdout.write(JSON.stringify({ id: req.id, error: e.message }) + '\n'); }
  });
});
