import { Server } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Inherited by isolated child processes; record the actual listener, not its shell parent.
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address();
    const home = process.env.METATROOPER_HOME;
    if (home && address && typeof address === 'object' && address.port) {
      const dir = join(home, 'listener-pids');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, String(process.pid)), String(process.pid));
    }
  });
  return listen.apply(this, args);
};
