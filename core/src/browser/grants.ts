const look = ['panes', 'navigate', 'snapshot', 'screenshot', 'scroll', 'read', 'find', 'handoff', 'export_test'];
const act = [...look, 'back', 'click', 'type', 'key', 'select', 'wait_for', 'dialog', 'batch'];
/** Browser tool presets, each holding the one before it. */
export const PRESETS: Record<string, string[]> = { look, act, debug: [...act, 'console', 'network', 'evaluate'] };

export const isPreset = (name: unknown): name is string => typeof name === 'string' && Object.hasOwn(PRESETS, name);

/** The smallest preset holding the tool, or null. */
export const smallestPreset = (tool: string): string | null => Object.keys(PRESETS).find((n) => PRESETS[n].includes(tool)) ?? null;
