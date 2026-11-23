import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

// Keep the runner and its Electron fixture in one file. Like m8-s4-handoff,
// the fixture needs module mocks enabled in a fresh node:test subprocess.
if (process.env.FIX_W07_AGENT_PARTITION_FIXTURE !== '1') {
  test('FIX-W7a agent partition lifecycle with fake Electron', () => {
    const env = { ...process.env, FIX_W07_AGENT_PARTITION_FIXTURE: '1' };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      '--experimental-test-module-mocks', '--no-warnings', '--test',
      '--test-reporter=tap', fileURLToPath(import.meta.url),
    ], { encoding: 'utf8', timeout: 20000, env });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^# pass 3$/m);
    assert.match(result.stdout, /^# fail 0$/m);
  });
} else {
  type Handler = ((...args: any[]) => unknown) | null;
  function makeSession() {
    const calls = {
      onBeforeRequest: [] as Handler[],
      onBeforeSendHeaders: [] as Handler[],
      onHeadersReceived: [] as Handler[],
      permissionCheck: [] as Handler[],
      permissionRequest: [] as Handler[],
    };
    return Object.assign(new EventEmitter(), {
      calls,
      clearCalls: 0,
      userAgent: 'Mozilla/5.0 Chrome/142.0.7444.59 Electron/44.4.5 Safari/537.36',
      getUserAgent() { return this.userAgent; },
      setUserAgent(value: string) { this.userAgent = value; },
      webRequest: {
        onBeforeRequest(handler: Handler) { calls.onBeforeRequest.push(handler); },
        onBeforeSendHeaders(handler: Handler) { calls.onBeforeSendHeaders.push(handler); },
        onHeadersReceived(handler: Handler) { calls.onHeadersReceived.push(handler); },
      },
      setPermissionCheckHandler(handler: Handler) { calls.permissionCheck.push(handler); },
      setPermissionRequestHandler(handler: Handler) { calls.permissionRequest.push(handler); },
      clearStorageData() { this.clearCalls++; return Promise.resolve(); },
    });
  }
  const partitions = new Map<string, ReturnType<typeof makeSession>>();
  function fromPartition(name: string) {
    if (!partitions.has(name)) partitions.set(name, makeSession());
    return partitions.get(name)!;
  }
  mock.module('electron', { exports: {
    app: {}, clipboard: {}, Menu: {}, nativeImage: {},
    session: { fromPartition }, WebContentsView: class {},
  } });
  const { PaneManager } = await import('../src/browser/panes.ts');

  function harness() {
    partitions.clear();
    const win = {
      isDestroyed: () => false,
      contentView: { removeChildView() {} },
    };
    const pm = new PaneManager(win as never, {
      db: () => null, probe() {}, urlChanged() {}, commentPicked() {},
      paneEvent() {}, openPane() {},
    } as never);
    const internal = pm as any;
    function open(id: string, project = 'project-1', lent = false) {
      const row = {
        id, project_id: project, lent,
        session_id: id.startsWith('bp_agent_') ? 'session-1' : null,
      };
      const ses = internal.guardPartition(row) as ReturnType<typeof makeSession>;
      let closed = false;
      const pane = {
        row,
        view: { webContents: {
          session: ses, isDestroyed: () => closed, close() { closed = true; },
        } },
        overlay: { webContents: { isDestroyed: () => true } },
        dbg: { detach() {} }, popups: new Set(),
      };
      internal.panes.set(id, pane);
      const partition = [...partitions].find(([, value]) => value === ses)![0];
      return { id, ses, partition };
    }
    async function close(id: string) {
      internal.destroy(id);
      // Let destroy's clearStorageData().then(...) return the partition to spare.
      await Promise.resolve();
    }
    return { internal, open, close };
  }

  test('five sequential agent panes reuse one partition and leave no guards', async () => {
    const h = harness();
    let first: ReturnType<typeof makeSession> | undefined;
    for (let n = 0; n < 5; n++) {
      const pane = h.open(`bp_agent_sequential_${n}`);
      first ??= pane.ses;
      assert.equal(pane.ses, first, 'each new pane reuses the cleared session');
      assert.equal(h.internal.guarded.size, 1);
      await h.close(pane.id);
      assert.equal(partitions.size, 1, `distinct agent partitions after close ${n + 1}`);
      assert.equal(h.internal.guarded.size, 0, `guards after close ${n + 1}`);
    }
    assert.equal(first!.clearCalls, 5);
  });

  test('closing an agent pane detaches request, header, permission and download handlers', async () => {
    const h = harness();
    const pane = h.open('bp_agent_cleanup');
    for (const calls of Object.values(pane.ses.calls)) {
      assert.equal(calls.length, 1);
      assert.equal(typeof calls[0], 'function', 'guard installed before closing');
    }
    assert.equal(pane.ses.listenerCount('will-download'), 1);
    await h.close(pane.id);
    for (const [name, calls] of Object.entries(pane.ses.calls)) {
      assert.equal(calls.length, 2, `${name} is detached once`);
      assert.equal(calls[1], null, `${name} is explicitly nulled`);
    }
    assert.equal(pane.ses.listenerCount('will-download'), 0);
    assert.equal(pane.ses.clearCalls, 1);
    assert.equal(h.internal.guarded.size, 0);
  });

  test('concurrent agents have distinct partitions; lent and user sessions keep their guards', async () => {
    const h = harness();
    const first = h.open('bp_agent_concurrent_1');
    const second = h.open('bp_agent_concurrent_2');
    assert.notEqual(first.partition, second.partition);
    assert.notEqual(first.ses, second.ses);
    assert.equal(partitions.size, 2);
    await h.close(first.id);
    await h.close(second.id);

    // Use separate projects so each persistent session is independently guarded.
    for (const [id, project, lent] of [
      ['bp_agent_lent', 'lent-project', true],
      ['bp_user_kept', 'user-project', false],
    ] as const) {
      const pane = h.open(id, project, lent);
      assert.equal(pane.partition, `persist:troop-${project}`);
      const handlers = Object.fromEntries(Object.entries(pane.ses.calls)
        .map(([name, calls]) => [name, [...calls]]));
      for (const calls of Object.values(handlers)) {
        assert.equal(calls.length, 1);
        assert.equal(typeof calls[0], 'function');
      }
      const downloads = pane.ses.listeners('will-download');
      assert.equal(downloads.length, 1);
      await h.close(pane.id);
      assert.deepEqual(pane.ses.calls, handlers, 'persistent session handlers are retained');
      assert.deepEqual(pane.ses.listeners('will-download'), downloads);
      assert.equal(pane.ses.clearCalls, 0, 'persistent storage is retained');
      assert.ok(h.internal.guarded.has(pane.partition));
      const spare = [...(h.internal.spare as Map<string, string[]>).values()].flat();
      assert.ok(!spare.includes(pane.partition), 'persistent partition is never spare');
      const agent = h.open(`bp_agent_after_${project}`, project);
      assert.notEqual(agent.partition, pane.partition);
      assert.notEqual(agent.ses, pane.ses);
      await h.close(agent.id);
    }
  });
}
