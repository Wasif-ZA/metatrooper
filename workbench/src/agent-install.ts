import path from 'node:path';

export const INSTALLABLE = {
  claude: { pkg: '@anthropic-ai/claude-code', bin: 'claude' },
  codex: { pkg: '@openai/codex', bin: 'codex login' },
};

type ToolOptions = { packaged: boolean; resourcesPath: string; home: string; path: string };

export function toolPath(options: ToolOptions): string {
  return options.packaged ? [path.join(options.resourcesPath, 'node'), path.join(options.home, 'tools'), options.path].join(';') : options.path;
}

export function installPlan(engineId: string, options: ToolOptions & { comspec: string }) {
  if (!Object.hasOwn(INSTALLABLE, engineId)) return null;
  const engine = INSTALLABLE[engineId as keyof typeof INSTALLABLE];
  const npm = options.packaged ? `"${path.join(options.resourcesPath, 'node', 'npm.cmd')}" install -g --prefix "${path.join(options.home, 'tools')}"` : 'npm install -g';
  const line = `${npm} ${engine.pkg} && ${engine.bin}`;
  return { command: options.comspec, args: ['/d', '/s', '/k', '"' + line + '"'], env: { PATH: toolPath(options) } };
}
