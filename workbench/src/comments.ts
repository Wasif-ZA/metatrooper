const BS = String.fromCharCode(92);

export function diffLineBody(id: string, note: string, file: string, line: number, text: string): string {
  return [`[comment ${id}] ${note}`, `File: ${file}:${line}`, `Line: ${text.slice(0, 500)}`].join('\n');
}

export function filesBody(id: string, paths: string[]): string {
  return [`[comment ${id}] Files dropped for you:`, ...paths.map((p) => `- ${p.split(BS).join('/')}`)].join('\n');
}
