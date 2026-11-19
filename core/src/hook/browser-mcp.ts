import { browserTools, browserToolList, UNAVAILABLE } from './browser-tools.ts';
import { call } from '../pipe/client.ts';
import { WorkbenchPipe, findSession, type Reply } from './workbench-pipe.ts';
import { serveMcp } from './mcp-stdio.ts';
import { screenResult } from './screen-data.ts';

const workbench = new WorkbenchPipe(UNAVAILABLE);
async function core(method: string, params: Record<string, unknown>, waitMs = 60_000): Promise<Reply> {
  const out = await call(method, params, { waitMs });
  if (out.kind !== 'reply') return { error: { code: -32099, message: method === 'approval.check' || method === 'desktop.act' ? 'not sent: the cc core is offline, so this action cannot be checked' : 'the cc core is offline' } };
  return out.reply;
}
const tools = browserTools({ sessionId: findSession() ?? '', pid: process.pid, core, workbench });
serveMcp('metatrooper-browser', () => browserToolList(workbench), async (name, args) => screenResult(await tools(name, args)));
