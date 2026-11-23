import type { ToolDef } from './mcp-stdio.ts';

export const STEPS_TOOL: ToolDef = {
  name: 'steps_set',
  description: 'Show your plan to the user as a checklist in cc. Call it once you have a plan of 2 or more steps, and again each time a step is done or the plan changes. Send the whole list every time; it replaces the last one. Short step text, up to 30 steps.',
  inputSchema: {
    type: 'object',
    properties: { items: { type: 'array', maxItems: 30, items: { type: 'object', properties: { text: { type: 'string', maxLength: 200 }, done: { type: 'boolean' } }, required: ['text', 'done'] } } },
    required: ['items'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
};

export const UI_TOOL: ToolDef = {
  name: 'ouros_ui',
  description: 'Draw a screen for the user in cc as a tab. Send JSON naming catalogue parts; cc checks every part and draws it itself. No HTML, script or outside URL is ever drawn. A part that is unknown or has a wrong prop is shown as a plain-text box naming it; its siblings still draw. The same surface id replaces your earlier screen; you cannot replace a surface drawn by another session. Parts drawn so far: page {children}, section {label, children, aside?}, header {title, sub?, big?, tabs?}, text {text, size?: h1|h2|body|small, tone?: plain|mute|ok|error}, table {cols: string[], rows: (string | part)[][], foot?}, buttons {actions: [{label, primary?}]} (buttons do nothing yet). Every other catalogue part is shown as text for now. Up to 12 levels and 1,500 parts. Returns {surface, status: drawn|partly|rejected, fellBack}. Live values: write a prop as {"bind": "/tokens"} and later call with only surface and data: {path: "/tokens", value: 51200}; the screen redraws without resending parts. A part whose bound value has not arrived, or a child id not sent yet, draws as a spinner.',
  inputSchema: {
    type: 'object',
    properties: {
      surface: { type: 'string', description: 'Id, 1 to 64 letters, digits, dots, dashes or underscores, e.g. "run-r0412".' },
      title: { type: 'string', description: 'The tab title.' },
      zone: { type: 'string', enum: ['tab'], default: 'tab' },
      catalogue: { type: 'string', description: 'Catalogue version you wrote against; "1".' },
      spec: { type: 'object', description: 'Usually { "type": "page", "children": [ ... ] }.' },
      data: { type: 'object', description: 'Instead of spec: {path: JSON pointer, value} sets one live value on a surface you drew.', properties: { path: { type: 'string' }, value: {} }, required: ['path'] },
    },
    required: ['surface'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
};

export const WORKSPACE_TOOL: ToolDef = {
  name: 'ouros_workspace',
  description: 'Change the layout of the user\'s cc IDE when they ask for it. op set sends a whole layout: {name, asked?: the user\'s words, rail: subset of files|search|git|debug|agents|ext|todo, layout: pane}. A pane is {split: "row"|"col", sizes: number[] (shares, each at least 8), children: pane[] (2 or more)}, {view: "explorer"|"editor"|"agent"|"terminal"|"wall"}, {view: "surface", spec: <a surface id you drew with ouros_ui>} or {view: "kit", title?, part: <a catalogue part>}; at most 4 levels deep. cc checks it; a bad layout is refused, the old one stays, and the reasons come back in last.reasons. The user can undo any change with Ctrl Z and go back to their usual layout with Ctrl Alt 0; the title bar, status bar, gates and inbox always stay. op save {name} names the current layout; op restore {name} applies a saved one. op example {name} applies a shipped layout: dev, video, bakery, revise and the persona-* layouts (analyst, editor, engineer, researcher, shop, student, website, writer).',
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['set', 'save', 'restore', 'example'], default: 'set' },
      workspace: { type: 'object', description: 'The whole layout, for op set.' },
      name: { type: 'string', description: 'The layout name, for op save, restore and example.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
};

export const ENGINE_TOOL: ToolDef = {
  name: 'ouros_engine',
  description: 'Run one action of an installed cc plugin (an engine such as whisper) in this project. cc checks the plugin is installed, enabled, not blocked and unchanged since it was approved, then runs the action with only its approved permissions; a program the plugin ships runs in a Windows sandbox. Give surface (one you drew with ouros_ui) and the action fills that screen through its binds, so you do not resend the screen. An action that leaves this machine (publish, send, deploy) waits until the user approves it in cc; you may wait a while. Returns {status: ok|failed, outputs, error, bound, run}.',
  inputSchema: {
    type: 'object',
    properties: {
      engine: { type: 'string', description: 'The plugin id.' },
      action: { type: 'string', description: 'The action id from the plugin manifest.' },
      input: { type: 'object', description: 'The action input, checked against its input_schema.' },
      surface: { type: 'string', description: 'A surface id you drew, for the action binds.' },
    },
    required: ['engine', 'action'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
};
