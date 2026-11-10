// Optional in-memory mutation probe; never rewrites production files.
import fs from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
const mode = process.env.WIRING_MUTANT;
function mutate(file, source) {
  if (mode === 'utf8' && file.endsWith('/workbench/src/files.ts')) return source.replace(/^    if \(!Buffer\.from\([^\n]+not UTF-8 text[^\n]+\n/gm, '');
  if (mode === 'stdin' && file.endsWith('/workbench/src/gitpane.ts')) return source.replace("['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], list.join('\\0')", "['--literal-pathspecs', 'add', '--', ...list]");
  if (mode === 'nul' && file.endsWith('/workbench/src/gitpane.ts')) return source.replace("!r.includes('\\0') && ", '');
  if (mode === 'close' && file.endsWith('/workbench/src/main.ts')) return source.replace(/  if \(dirtyFiles && win && !win.isDestroyed\(\)\) \{[^]*?\n  \}/, '');
  if (mode === 'ipc' && file.endsWith('/workbench/src/main.ts')) return source.replace("typeof method !== 'string' || !UI_METHODS.has(method)", 'false');
  if (mode === 'script' && file.endsWith('/core/src/methods.ts')) return source.replace(/      if \(!rel \|\| rel.startsWith\('\.\.'\)[^\n]+\n/, '');
  if (mode === 'hash' && file.endsWith('/core/src/automations.ts')) return source.replace("createHash('sha256').update(deps.readFile(abs)).digest('hex') !== a.script_sha256", 'false');
  if (mode === 'permissions' && file.endsWith('/core/src/plugins/store.ts')) return source.replace('if (unapproved.length || extra.length)', 'if (false)');
  return source;
}
const read = fs.readFileSync;
fs.readFileSync = function(p, ...args) {
  const result = read.call(this, p, ...args);
  return typeof result === 'string' ? mutate(String(p).replaceAll('\\', '/'), result) : result;
};
syncBuiltinESMExports();
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (result.source && url.startsWith('file:')) result.source = mutate(decodeURIComponent(url), typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString());
  return result;
} });
