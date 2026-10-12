const BS = String.fromCharCode(92);

export function diffLineBody(id: string, note: string, file: string, line: number, text: string): string {
  return [`[comment ${id}] ${note}`, `File: ${file}:${line}`, `Line: ${text.slice(0, 500)}`].join('\n');
}

export function copied(out: { kind: string; reply?: { result?: unknown; error?: unknown } }): boolean {
  return out.kind === 'reply' && !out.reply?.error && Boolean((out.reply?.result as { clipboard_at?: unknown } | undefined)?.clipboard_at);
}

export function filesBody(id: string, paths: string[]): string {
  return [`[comment ${id}] Files dropped for you:`, ...paths.map((p) => `- ${p.split(BS).join('/')}`)].join('\n');
}
