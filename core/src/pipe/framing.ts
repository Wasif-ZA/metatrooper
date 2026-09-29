export const MAX_LINE = 1024 * 1024;

export class LineTooLong extends Error {
  constructor() {
    super('line exceeds 1 MiB');
    this.name = 'LineTooLong';
  }
}

export function encode(msg: object): string {
  const s = JSON.stringify(msg);
  if (Buffer.byteLength(s) > MAX_LINE) throw new LineTooLong();
  return s + '\n';
}

export function createDecoder(
  onMessage: (msg: unknown) => void,
  onParseError?: (e: Error) => void,
): (chunk: Buffer | string) => void {
  let buf = '';
  return (chunk) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (Buffer.byteLength(line) > MAX_LINE) throw new LineTooLong();
      if (line.trim() === '') continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        if (!onParseError) throw e;
        onParseError(e as Error);
        continue;
      }
      onMessage(msg);
    }
    if (Buffer.byteLength(buf) > MAX_LINE) {
      buf = '';
      throw new LineTooLong();
    }
  };
}
