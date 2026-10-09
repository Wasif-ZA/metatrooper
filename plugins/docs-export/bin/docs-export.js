import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${path.basename(cmd)} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
  return r.stdout;
}

// ponytail: text only, one file per page; page images need a rasteriser (pdftoppm) that is not installed here.
export function ingest(input) {
  const tool = [process.env.TROOP_PDFTOTEXT, 'C:/Program Files/Git/mingw64/bin/pdftotext.exe'].find((c) => c && fs.existsSync(c)) || 'pdftotext';
  const text = run(tool, ['-layout', '-enc', 'UTF-8', input.path, '-']);
  const pages = text.split('\f');
  if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
  if (!pages.some((p) => p.trim())) throw new Error(`no text in ${input.path}: a scanned PDF needs OCR, which is not installed`);
  fs.mkdirSync(input.out, { recursive: true });
  const width = String(pages.length).length;
  const files = pages.map((page, i) => {
    const file = path.join(input.out, `p${String(i + 1).padStart(width, '0')}.txt`);
    fs.writeFileSync(file, page.replace(/[ \t]+$/gm, '').trim() + '\n');
    return path.basename(file);
  });
  return { out: input.out, pages: pages.length, files, empty: pages.map((p, i) => (p.trim() ? 0 : i + 1)).filter(Boolean) };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');

// ponytail: headings, paragraphs, lists, tables, fenced code and quotes; no nested lists or footnotes.
export function markdownToHtml(md) {
  const out = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(line)) {
      const n = line.match(/^#+/)[0].length;
      out.push(`<h${n}>${inline(line.slice(n).trim())}</h${n}>`);
    } else if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(line);
      i++;
      const body = [];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) body.push(cells(lines[++i]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) items.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
      i--;
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else if (/^>\s?/.test(line)) {
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
    } else if (line.trim()) {
      const para = [line];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\s*\||\s*([-*]|\d+\.)\s|>)/.test(lines[i + 1])) para.push(lines[++i]);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

function browser() {
  const candidates = [
    process.env.TROOP_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((c) => c && fs.existsSync(c));
  if (!found) throw new Error('no Chrome or Edge found; set TROOP_CHROME');
  return found;
}

export function exportPdf(input, chrome = browser) {
  const md = fs.readFileSync(input.path, 'utf8');
  const css = (input.css && fs.existsSync(input.css) ? fs.readFileSync(input.css, 'utf8') : '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(?!["']?data:)[^)]*\)/gi, 'none')
    .replace(/<\/style/gi, '');
  const title = (md.match(/^#\s+(.+)$/m) || [])[1] || path.basename(input.path, '.md');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page { size: ${input.paper || 'A4'}; margin: 18mm; } body { font: 11pt/1.45 Georgia, serif; } table { border-collapse: collapse; } th, td { border: 1px solid #999; padding: 3px 6px; } pre { white-space: pre-wrap; }\n${css}</style></head><body>${markdownToHtml(md)}</body></html>`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-pdf-'));
  try {
    const page = path.join(tmp, 'page.html');
    fs.writeFileSync(page, html);
    const out = path.resolve(input.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    run(chrome(), ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${path.join(tmp, 'profile')}`, `--print-to-pdf=${out}`, pathToFileURL(page).href]);
    if (!fs.existsSync(out)) throw new Error(`the browser wrote no PDF at ${out}`);
    const bytes = fs.readFileSync(out).toString('latin1');
    return { out: input.out, pages: (bytes.match(/\/Type\s*\/Page\b/g) || []).length, bytes: fs.statSync(out).size };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const fn = { ingest, 'export-pdf': exportPdf }[process.argv[2]];
    if (!fn) throw new Error(`unknown action ${process.argv[2]}`);
    process.stdout.write(JSON.stringify({ ok: true, outputs: fn(req.input || {}) }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
  }
}
