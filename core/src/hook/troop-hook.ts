// Runs the core script named by the first argument (event.js, codex-notify.js); the installed troop-hook.cmd calls it.
const name = process.argv.splice(2, 1)[0] ?? '';
if (!/^[a-z-]+\.js$/.test(name)) process.exit(2);
await import(new URL(`../../${name}`, import.meta.url).href);
