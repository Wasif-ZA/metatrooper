import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Dialog } from '@astryxdesign/core/Dialog';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { createByte } from './byte.js';
import { STOPS, visible, offerOnEvent, offerOnStart, answerOffer, createTour, menuItems, planLabel, profileOf } from './tour.js';
import './tour.css';

function RailTrigger({ trigger }) {
  useLayoutEffect(() => {
    const el = document.getElementById('account');
    trigger.ref(el);
    return () => trigger.ref(null);
  }, [trigger.ref]);
  useLayoutEffect(() => {
    const el = document.getElementById('account');
    const pointerdown = (event) => trigger.onPointerDown({ nativeEvent: event, pointerId: event.pointerId, pointerType: event.pointerType, button: event.button, ctrlKey: event.ctrlKey });
    const handlers = { click: trigger.onClick, pointerdown, contextmenu: trigger.onContextMenu, keydown: trigger.onKeyDown, focus: trigger.onFocus };
    for (const [name, fn] of Object.entries(handlers)) if (fn) el.addEventListener(name, fn);
    el.addEventListener('click', trigger.onClickCapture, true);
    for (const key of ['aria-haspopup', 'aria-expanded', 'aria-controls']) {
      if (trigger[key] === undefined) el.removeAttribute(key);
      else el.setAttribute(key, String(trigger[key]));
    }
    return () => {
      for (const [name, fn] of Object.entries(handlers)) if (fn) el.removeEventListener(name, fn);
      el.removeEventListener('click', trigger.onClickCapture, true);
    };
  }, [trigger]);
  return <span id={trigger.id} hidden>Account</span>;
}

function Byte({ label }) {
  const canvas = useRef(null), engine = useRef(null);
  useEffect(() => {
    engine.current = createByte(canvas.current);
    return () => { engine.current.stop(); engine.current = null; };
  }, []);
  useEffect(() => { if (label) engine.current?.morph(label, 1200); engine.current?.moveTo(64, 64); }, [label]);
  return <canvas ref={canvas} width={128} height={128} className="cc-byte" aria-hidden="true" />;
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function placeBubble(box, size) {
  const inset = 12, gap = 88, width = Math.min(336, box.viewportWidth - inset * 2);
  const height = size.height, cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  const room = { below: box.viewportHeight - box.bottom - inset, above: box.top - inset, right: box.viewportWidth - box.right - inset, left: box.left - inset };
  const order = box.top < 100 ? ['below', 'right', 'left', 'above'] : ['right', 'left', 'above', 'below'];
  const horizontal = (side) => side === 'left' || side === 'right';
  const side = order.find((s) => room[s] >= (horizontal(s) ? width : height) + gap)
    ?? order.reduce((a, b) => room[a] / (horizontal(a) ? width : height) >= room[b] / (horizontal(b) ? width : height) ? a : b);
  const available = Math.max(0, room[side]);
  const offset = Math.min(gap, Math.max(12, available / 3));
  const w = horizontal(side) ? Math.min(width, Math.max(1, available - offset)) : width;
  const h = horizontal(side) ? Math.min(height, box.viewportHeight - inset * 2) : Math.min(height, Math.max(1, available - offset));
  const clamp = (n, max) => Math.max(inset, Math.min(max, n));
  const left = side === 'right' ? box.right + offset : side === 'left' ? box.left - offset - w : clamp(box.left, box.viewportWidth - inset - w);
  const top = side === 'below' ? box.bottom + offset : side === 'above' ? box.top - offset - h : clamp(box.top, box.viewportHeight - inset - h);
  const caret = Math.max(16, Math.min((horizontal(side) ? h : w) - 16, horizontal(side) ? cy - top : cx - left));
  return { side, style: { left, top, width: w, maxHeight: h, '--caret': `${caret}px`, '--byte-size': `${Math.min(80, offset - 8)}px` } };
}

export function AccountTour() {
  const [look, setLook] = useState(null), [status, setStatus] = useState({}), [pro, setPro] = useState(false);
  const [offer, setOffer] = useState(false), [dialog, setDialog] = useState(false), [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(''), [tour, setTour] = useState(null), [step, setStep] = useState(0), [box, setBox] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [bubbleSize, setBubbleSize] = useState({ height: 160 });
  const setting = useRef(undefined), ready = useRef(false), eventSeen = useRef(false), pending = useRef(false), attempt = useRef(0), tourRef = useRef(null), bubble = useRef(null), previousFocus = useRef(null);
  const startupSessions = useRef(ui.snap?.has_sessions);
  const refresh = async () => {
    const r = await rpc('auth.status', {}, true);
    if (r.result) { const profile = profileOf(r.result); setStatus(profile); return profile; }
  };
  useEffect(() => {
    let mounted = true;
    const firstRun = () => { eventSeen.current = true; if (ready.current && offerOnEvent(setting.current)) setOffer(true); };
    window.addEventListener('cc:first-run-done', firstRun);
    const offSnapshot = api.onSnapshot((snapshot) => {
      if (startupSessions.current !== undefined) return;
      startupSessions.current = snapshot.has_sessions;
      if (ready.current && offerOnStart(setting.current, snapshot.has_sessions)) setOffer(true);
    });
    void Promise.all([api.uiSettings(), api.addons().catch(() => [])]).then(([data, plugins]) => {
      if (!mounted) return;
      setLook(data); setting.current = data.ui?.tour; ready.current = true;
      setPro(Array.isArray(plugins) && plugins.some((p) => p.id === 'cc-pro' && p.enabled));
      if ((eventSeen.current && offerOnEvent(setting.current)) || offerOnStart(setting.current, startupSessions.current)) setOffer(true);
    }).catch((e) => { if (mounted) toast(e.message, true); });
    void refresh();
    return () => { mounted = false; offSnapshot(); window.removeEventListener('cc:first-run-done', firstRun); tourRef.current?.skip(); };
  }, []);
  useEffect(() => {
    const button = document.querySelector('.ffoot [data-view="addons"]');
    button?.toggleAttribute('data-tour-pro', pro);
  }, [pro]);
  useEffect(() => {
    document.getElementById('account-tour').toggleAttribute('data-overlay', Boolean(menuOpen || dialog || tour || scanning));
  }, [menuOpen, dialog, tour, scanning]);

  const icon = document.querySelector('#account .fi');
  const [badPicture, setBadPicture] = useState(null);
  const picture = !document.body.classList.contains('demo') && status.signed_in && status.picture && status.picture !== badPicture && /^https:\/\//.test(status.picture) ? status.picture : null;
  useLayoutEffect(() => {
    if (!icon) return;
    if (picture) icon.querySelectorAll('svg').forEach((el) => el.remove());
    else icon.innerHTML = globalThis.ourosIcon?.('person', 16) || '';
  }, [icon, picture]);

  async function recordOffer() {
    if (!offer || !offerOnEvent(setting.current)) return;
    await answerOffer('yes', (value) => api.setTour(value));
    setting.current = 'done'; setOffer(false);
  }

  async function start() {
    if (pending.current || tourRef.current?.active) return;
    pending.current = true; setDialog(false); setError('');
    const startView = ui.view, focus = document.activeElement, available = new Map();
    const settingsWasOpen = settingsView.isOpen();
    if (settingsWasOpen) settingsView.close();
    let openedSettings = false;
    try {
      await recordOffer();
      setOffer(false); setScanning(true);
      await frame(); await frame();
      const candidates = STOPS.filter((s) => s.id !== 'account' || look?.authConfigured);
      for (const view of new Set(candidates.map((s) => s.view ?? startView))) {
        if (ui.view !== view) homeView.set(view);
        await frame();
        for (const stop of candidates.filter((s) => (s.view ?? startView) === view)) {
          if (stop.id === 'notify') { openedSettings = true; await settingsView.open('notify'); await frame(); }
          const el = Array.from(document.querySelectorAll(stop.selector)).find(visible);
          if (visible(el)) {
            const rect = el.getBoundingClientRect();
            available.set(stop.selector, { isConnected: true, hidden: false, parentElement: null, getBoundingClientRect: () => rect });
          }
          if (stop.id === 'notify') { settingsView.close(); openedSettings = false; }
        }
      }
      homeView.set(startView);
      previousFocus.current = focus;
      const run = createTour({
        doc: { querySelectorAll: (selector) => available.has(selector) ? [available.get(selector)] : [] }, stops: candidates,
        getView: () => ui.view, setView: (view) => homeView.set(view),
        onEnd: () => { setTour(null); setBox(null); tourRef.current = null; previousFocus.current?.focus?.(); if (settingsWasOpen) void settingsView.open(); },
      });
      tourRef.current = run; run.start();
      if (run.active) { setTour(run); setStep(0); }
    } catch (e) { homeView.set(startView); if (settingsWasOpen) void settingsView.open(); toast(e.message, true); }
    finally { if (openedSettings) settingsView.close(); setScanning(false); pending.current = false; }
  }

  function next() { tourRef.current?.next(); setStep((n) => n + 1); }
  useEffect(() => {
    if (!tour?.active) return;
    let request, disposed = false;
    const notification = tour.current()?.id === 'notify';
    const settingsWasOpen = settingsView.isOpen();
    let ready = !notification;
    const measure = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(() => {
        if (disposed || !tour.active || !ready) return;
        const target = Array.from(document.querySelectorAll(tour.current().selector)).find(visible);
        if (!visible(target)) { next(); return; }
        const r = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        const radius = Math.max(...['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].map((key) => parseFloat(style[key]) || 0)) + 5;
        const value = { radius, left: Math.max(0, r.left - 5), top: Math.max(0, r.top - 5), right: Math.min(innerWidth, r.right + 5), bottom: Math.min(innerHeight, r.bottom + 5), viewportWidth: innerWidth, viewportHeight: innerHeight };
        setBox((old) => JSON.stringify(old) === JSON.stringify(value) ? old : value);
      });
    };
    const keys = (e) => {
      if (e.key === 'Enter' && document.activeElement?.tagName === 'BUTTON') return;
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.key === 'Escape') tour.skip(); else next();
      } else if (e.key === 'Tab') {
        const buttons = bubble.current?.querySelectorAll('button');
        if (!buttons?.length) return;
        if (!bubble.current.contains(document.activeElement)) { e.preventDefault(); buttons[0].focus(); }
        else if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === buttons[buttons.length - 1]) { e.preventDefault(); buttons[0].focus(); }
      }
    };
    const focusNext = () => {
      const buttons = bubble.current?.querySelectorAll('button');
      buttons?.[buttons.length - 1]?.focus();
    };
    if (notification) void settingsView.open('notify').then(() => {
      if (disposed) { if (!settingsWasOpen) settingsView.close(); return; }
      ready = true; measure(); focusNext();
    }).catch(() => { if (!disposed) next(); });
    else measure();
    focusNext();
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    window.addEventListener('resize', measure); document.addEventListener('scroll', measure, true); window.addEventListener('keydown', keys, true);
    return () => { disposed = true; cancelAnimationFrame(request); observer.disconnect(); window.removeEventListener('resize', measure); document.removeEventListener('scroll', measure, true); window.removeEventListener('keydown', keys, true); if (notification && !settingsWasOpen) settingsView.close(); };
  }, [tour, step]);

  useLayoutEffect(() => {
    const card = bubble.current?.querySelector('.cc-tour-card');
    if (!card) return;
    const measure = () => {
      const height = card.getBoundingClientRect().height;
      setBubbleSize((old) => old.height === height ? old : { height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [tour, step, box]);

  useLayoutEffect(() => {
    if (tour?.active && box) bubble.current?.querySelector('button:last-child')?.focus();
  }, [tour, step, Boolean(box)]);

  async function answer(choice) {
    if (pending.current) return;
    pending.current = true;
    try {
      const yes = await answerOffer(choice, (value) => api.setTour(value));
      setting.current = choice === 'yes' ? 'done' : 'later'; setOffer(false);
      pending.current = false;
      if (yes) await start();
    } catch (e) { setError(e.message); } finally { pending.current = false; }
  }
  function cancelSignIn() {
    attempt.current++;
    if (waiting) void rpc('auth.signOut', {}, true).then(refresh).finally(() => setWaiting(false));
    setDialog(false); setError('');
  }
  async function signIn() {
    if (waiting) return;
    const id = ++attempt.current;
    setWaiting(true); setError('');
    try {
      const r = await rpc('auth.signIn', {}, true);
      if (id !== attempt.current) return;
      if (r.error) throw new Error(r.error.message);
      const profile = await refresh();
      if (id !== attempt.current) return;
      setDialog(false); toast(`Signed in as ${profile?.name || profile?.email || 'you'}`);
    } catch (e) { if (id === attempt.current) setError(e.message); }
    finally { if (id === attempt.current) setWaiting(false); }
  }
  const actions = {
    signin: async () => {
      if (pending.current) return;
      pending.current = true;
      try { setOffer(false); setError(''); setDialog(true); }
      catch (e) { setError(e.message); }
      finally { pending.current = false; }
    }, tour: start,
    manage: () => api.openLink('account'),
    signout: async () => { const r = await rpc('auth.signOut', {}, true); if (r.error) toast(r.error.message, true); await refresh(); },
  };
  const labels = { signin: 'Sign in', manage: 'Manage account', plan: planLabel(pro), tour: 'Take the tour', signout: 'Sign out' };
  const items = menuItems({ status, configured: look?.authConfigured, pro, manage: look?.manageConfigured }).filter((id) => id !== 'who').flatMap((id) => [
    ...(id === 'signout' ? [{ type: 'divider' }] : []),
    { id, label: labels[id], isDisabled: id === 'plan', onClick: actions[id] },
  ]);
  const placement = box ? placeBubble(box, bubbleSize) : null;
  return <>
    {picture && icon ? createPortal(<img src={picture} alt="" width={20} height={20} data-personal referrerPolicy="no-referrer" onError={() => setBadPicture(picture)} />, icon) : null}
    <DropdownMenu className="cc-account-menu" placement="above" menuWidth={240} items={items} onOpenChange={(open) => { setMenuOpen(open); if (open) { void refresh(); void api.addons().then((plugins) => setPro(Array.isArray(plugins) && plugins.some((p) => p.id === 'cc-pro' && p.enabled))).catch(() => {}); } }} header={!document.body.classList.contains('demo') && look?.authConfigured && status.signed_in ? <div className="cc-account-who" data-personal><Text>{status.name}</Text><Text color="secondary">{status.email}</Text></div> : undefined} renderTrigger={(trigger) => <RailTrigger trigger={trigger} />} />
    <Dialog isOpen={dialog} onOpenChange={(open) => { if (!open) cancelSignIn(); }} purpose="form" width={420} aria-label="Sign in to cc">
      <div className="cc-tour-content"><Heading level={2}>Sign in to cc</Heading><Text>An account is optional. Everything works without one.</Text>
        {waiting ? <Text role="status">Waiting for your browser...</Text> : null}
        {error ? <Text role="alert">{error}</Text> : null}
        <div className="cc-tour-actions"><Button variant="ghost" label="Cancel" onClick={cancelSignIn} /><Button variant="primary" label="Continue in browser" isDisabled={waiting} onClick={signIn} /></div>
      </div>
    </Dialog>
    {offer && !dialog && !tour ? <Card className="cc-tour-offer" padding={4} role="dialog" aria-label="Want the 1-minute tour?"><Byte /><div className="cc-tour-content"><Text>Want the 1-minute tour?</Text>{error ? <Text role="alert">{error}</Text> : null}<div className="cc-tour-actions"><Button variant="ghost" label="Not now" onClick={() => answer('later')} /><Button variant="primary" label="Yes" onClick={() => answer('yes')} /></div></div></Card> : null}
    {scanning || tour?.active ? <div className="cc-tour-running">
      <svg className="cc-tour-dimmer" width="100%" height="100%" aria-hidden="true">
        <defs><mask id="cc-tour-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width={innerWidth} height={innerHeight}><rect width="100%" height="100%" fill="white" />{box ? <rect x={box.left} y={box.top} width={box.right - box.left} height={box.bottom - box.top} rx={box.radius} fill="black" /> : null}</mask></defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,.55)" mask="url(#cc-tour-cutout)" />
      </svg>
      {tour?.active && placement ? <div ref={bubble} className="cc-tour-position" data-side={placement.side} style={placement.style} role="dialog" aria-modal="true" aria-label="Tour" aria-describedby="cc-tour-line">
        <Byte label={tour.current()?.morph} /><span className="cc-tour-caret" aria-hidden="true" /><div className="cc-tour-scroll"><Card className="cc-tour-card" padding={4}><div className="cc-tour-content"><Text id="cc-tour-line" aria-live="polite">{tour.current()?.line}</Text><div className="cc-tour-actions"><Button variant="ghost" label="Skip" onClick={() => tour.skip()} /><Text color="secondary">{tour.label()}</Text><Button label={tour.nextLabel()} onClick={next} /></div></div></Card></div>
      </div> : null}
    </div> : null}
  </>;
}
