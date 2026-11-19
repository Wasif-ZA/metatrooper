export const STOPS = [
  ['chat', '#home .ou-composer', 'home', 'hi', 'Type what you want done. An agent picks it up.'],
  ['access', '#home .ou-cmp-accent button[role="combobox"]', 'home', 'ok?', 'This decides what agents may do without asking you.'],
  ['needs', '.fnav [data-view="inbox"]', null, '!', 'When an agent needs a yes or an answer, it waits here.'],
  ['wall', '.fnav [data-view="wall"]', null, '[]', 'Every agent you run, side by side, live.'],
  ['palette', '[data-action="palette"]', null, 'K', 'Ctrl+K finds any agent or command.'],
  ['notify', '#settings .ou-scol', null, '@', 'Get pinged on your phone or desktop when an agent needs you.'],
  ['ide', '.fnav [data-view="ide"]', 'ide', '</>', 'Editor, search, git and diff comments, next to your agents.'],
  ['browser', '[data-tab="browser"]', 'wall', 'www', 'Agents can use a browser here. You approve each site.'],
  ['computer', '[data-action="grant-give"]', 'wall', 'win', 'On Windows, an agent can use an app window you lend it.'],
  ['drawn', '.ou-drawn-bar, .ou-drawn-chips', 'ide', '#', 'Agents can draw screens for you, in tabs.'],
  ['sessions', '#frame-agents', null, 'zz', 'Close cc any time. Your agents keep running and come back.'],
  ['account', '#account', null, 'me', 'Your account lives here. Signing in is optional; cc works the same without it.'],
  ['pro', '.ffoot [data-view="addons"][data-tour-pro]', null, '+', 'cc Pro adds Tasks, Review and Proof.'],
].map(([id, selector, view, morph, line]) => ({ id, selector, view, morph, line }));

export function visible(el) {
  if (!el || el.isConnected !== true) return false;
  for (let p = el; p; p = p.parentElement) if (p.hidden === true) return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

export function stopsFor(doc, stops = STOPS) {
  return stops.filter((s) => Array.from(doc.querySelectorAll?.(s.selector) ?? [doc.querySelector(s.selector)]).find(visible));
}

export const offerOnEvent = (tour) => tour == null || tour === '';
export const offerOnStart = (tour, hasSessions) => offerOnEvent(tour) && hasSessions === true;

export async function answerOffer(choice, setTour) {
  if (choice !== 'yes' && choice !== 'later') throw new Error('unknown tour choice');
  const result = await setTour(choice === 'yes' ? 'done' : 'later');
  if (result?.error) throw new Error(result.error);
  return choice === 'yes';
}

export function createTour({ doc, stops = STOPS, getView, setView, onEnd, defer = () => false }) {
  const list = stops.filter((stop) => defer(stop) || stopsFor(doc, [stop]).length), startView = getView();
  let active = false, index = 0, ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    active = false;
    if (getView() !== startView) setView(startView);
    onEnd?.();
  };
  const enter = () => {
    const view = list[index]?.view ?? startView;
    if (view !== getView()) setView(view);
  };
  return {
    get active() { return active; },
    get index() { return index; },
    get total() { return list.length; },
    current: () => active ? list[index] : null,
    label: () => `${index + 1} of ${list.length}`,
    nextLabel: () => index === list.length - 1 ? 'Done' : 'Next',
    start() { if (ended) return; if (!list.length) return end(); active = true; index = 0; enter(); },
    next() { if (!active) return; if (++index >= list.length) end(); else enter(); },
    skip: end,
  };
}

export function menuItems({ status, configured, pro, manage }) {
  if (!configured) return ['tour'];
  return status?.signed_in ? ['who', ...(manage === true ? ['manage'] : []), 'plan', 'tour', 'signout'] : ['signin', 'tour'];
}

export const planLabel = (pro) => pro === true ? 'Plan: Pro' : 'Plan: Free';
export function profileOf(status) {
  return Object.fromEntries(['signed_in', 'name', 'email', 'picture'].filter((k) => Object.hasOwn(status || {}, k)).map((k) => [k, status[k]]));
}
