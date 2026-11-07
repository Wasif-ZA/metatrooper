import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, isPreset, smallestPreset } from '../src/browser/grants.ts';

// The tool sets come from the M7-01 spec (Change 1) and contracts/browser-tools.md (version 3), not from the code.
const LOOK = ['panes', 'navigate', 'snapshot', 'screenshot', 'scroll', 'read', 'handoff'];
const ACT_ADDED = ['back', 'click', 'type', 'key', 'select', 'wait_for', 'dialog', 'batch'];
const DEBUG_ADDED = ['console', 'network', 'evaluate'];
const ACT = [...LOOK, ...ACT_ADDED];
const DEBUG = [...ACT, ...DEBUG_ADDED];

// PRESETS' value shape is not fixed by the spec; accept a list, a Set, or an object with a tools list.
function toolsOf(name: string): string[] {
  const value: any = (PRESETS as any) instanceof Map ? (PRESETS as any).get(name) : (PRESETS as any)[name];
  const list = Array.isArray(value) ? value : value instanceof Set ? [...value] : value?.tools;
  assert.ok(Array.isArray(list) || value instanceof Set, `PRESETS.${name} has no tool list`);
  return [...list].sort();
}

const sorted = (list: string[]) => [...list].sort();

// protects=look exposes exactly the seven read and navigate tools of the spec
// fails_when=a tool is added to or dropped from look (for example evaluate or click leaking in)
// no_claim=how the MCP server lists tools (tools/list) or the pipe refuses calls
test('M7-01a look holds exactly the 7 tools the spec names', () => {
  assert.equal(LOOK.length, 7);
  assert.deepEqual(toolsOf('look'), sorted(LOOK));
});

// protects=act is look plus the eight input and wait tools, and nothing from debug
// fails_when=act is missing a tool from the spec, or it includes console, network or evaluate
// no_claim=page_call, which the WebMCP spike excluded from M7
test('M7-01a act holds look plus back, click, type, key, select, wait_for, dialog and batch', () => {
  assert.deepEqual(toolsOf('act'), sorted(ACT));
  for (const tool of DEBUG_ADDED) assert.ok(!toolsOf('act').includes(tool), `act must not hold ${tool}`);
});

// protects=debug is every tool the presets name: act plus console, network and evaluate
// fails_when=debug drops one of its tools, or evaluate is only in some presets
// no_claim=that debug equals every tool the MCP server advertises (the server list is not read here)
test('M7-01a debug holds act plus console, network and evaluate', () => {
  assert.deepEqual(toolsOf('debug'), sorted(DEBUG));
  assert.equal(DEBUG.length, 18);
});

// protects=each preset holds the one before it, so a grant only ever adds tools
// fails_when=a preset loses a tool from the one below it
// no_claim=the order in which presets are listed
test('M7-01a presets nest: look is inside act, act is inside debug', () => {
  for (const tool of toolsOf('look')) assert.ok(toolsOf('act').includes(tool), `act lacks look tool ${tool}`);
  for (const tool of toolsOf('act')) assert.ok(toolsOf('debug').includes(tool), `debug lacks act tool ${tool}`);
});

// protects=only the three preset names are presets, so a misspelled grant is not accepted
// fails_when=isPreset accepts the misspelling 'evalute' or any unknown name
// no_claim=how the launch reports an unknown name (that is the integration test)
test('M7-01a isPreset accepts look, act and debug and rejects a misspelling', () => {
  for (const name of ['look', 'act', 'debug']) assert.equal(isPreset(name), true, name);
  assert.equal(isPreset('evalute'), false);
  assert.equal(isPreset('Look'), false, 'names are case sensitive');
  assert.equal(isPreset(''), false);
});

// protects=evaluate is named by its smallest preset, debug, so a refusal can say what to grant
// fails_when=smallestPreset('evaluate') is look or act
// no_claim=the message text of the -32039 refusal (that is the workbench test)
test('M7-01a smallestPreset names debug for evaluate', () => {
  assert.equal(smallestPreset('evaluate'), 'debug');
});

// protects=click is named by act, the smallest preset that holds it
// fails_when=smallestPreset('click') is look (click leaking into look) or debug
// no_claim=whether a click is then approved (D61 is a different check)
test('M7-01a smallestPreset names act for click', () => {
  assert.equal(smallestPreset('click'), 'act');
});

// protects=read is in look, so the smallest preset for it is look
// fails_when=smallestPreset('read') is act or debug, meaning read was moved out of look
// no_claim=that look's tool list is correct beyond read (covered by the 7-tool test)
test('M7-01a smallestPreset names look for read', () => {
  assert.equal(smallestPreset('read'), 'look');
});
