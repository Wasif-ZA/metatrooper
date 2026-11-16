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
    for (const key of ['aria-haspopup', 'aria-expanded', 'aria-controls']) el.setAttribute(key, String(trigger[key]));
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

export function AccountTour() {
  const [look, setLook] = useState(null), [status, setStatus] = useState({}), [pro, setPro] = useState(false);
  const [offer, setOffer] = useState(false), [dialog, setDialog] = useState(false), [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(''), [tour, setTour] = useState(null), [step, setStep] = useState(0), [box, setBox] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
    const button = document.querySelector('[data-view="addons"]');
    button?.toggleAttribute('data-tour-pro', pro);
  }, [pro]);
  useEffect(() => {
    document.getElementById('account-tour').toggleAttribute('data-overlay', Boolean(menuOpen || offer || dialog || tour));
  }, [menuOpen, offer, dialog, tour]);

  const icon = document.querySelector('#account .fi');
  const [badPicture, setBadPicture] = useState(null);
  const picture = status.signed_in && status.picture && status.picture !== badPicture && /^https:\/\//.test(status.picture) ? status.picture : null;
  useLayoutEffect(() => {
    if (!icon) return;
    if (picture) icon.querySelectorAll('svg').forEach((el) => el.remove());
    else icon.innerHTML = globalThis.ourosIcon?.('person', 16) || '';
  }, [icon, picture]);

  async function start() {
    if (pending.current || tourRef.current?.active) return;
    pending.current = true; setOffer(false); setDialog(false); setError('');
    const startView = ui.view, focus = document.activeElement, available = new Map();
    try {
      const candidates = STOPS.filter((s) => s.id !== 'account' || look?.authConfigured);
      for (const view of new Set(candidates.map((s) => s.view || startView))) {
        if (ui.view !== view) homeView.set(view);
        await frame();
        for (const stop of candidates.filter((s) => (s.view || startView) === view)) {
          if (stop.id === 'notify') { await settingsView.open('notify'); await frame(); }
          const el = document.querySelector(stop.selector);
          if (visible(el)) {
            const rect = el.getBoundingClientRect();
            available.set(stop.selector, { isConnected: true, hidden: false, parentElement: null, getBoundingClientRect: () => rect });
          }
          if (stop.id === 'notify') settingsView.close();
        }
      }
      homeView.set(startView);
      previousFocus.current = focus;
      const run = createTour({
        doc: { querySelector: (selector) => available.get(selector) }, stops: candidates,
        getView: () => ui.view, setView: (view) => homeView.set(view),
        onEnd: () => { setTour(null); setBox(null); tourRef.current = null; previousFocus.current?.focus?.(); },
      });
      tourRef.current = run; run.start();
      if (run.active) { setTour(run); setStep(0); }
    } catch (e) { homeView.set(startView); toast(e.message, true); }
    finally { pending.current = false; }
  }

  function next() { tourRef.current?.next(); setStep((n) => n + 1); }
  useEffect(() => {
    if (!tour?.active) return;
    let request;
    const measure = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(() => {
        if (!tour.active) return;
        const target = document.querySelector(tour.current().selector);
        if (!visible(target)) { next(); return; }
        const r = target.getBoundingClientRect();
        const value = { left: Math.max(0, r.left - 5), top: Math.max(0, r.top - 5), right: Math.min(innerWidth, r.right + 5), bottom: Math.min(innerHeight, r.bottom + 5), viewportWidth: innerWidth, viewportHeight: innerHeight };
        setBox((old) => JSON.stringify(old) === JSON.stringify(value) ? old : value);
      });
    };
    const keys = (e) => {
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
    let disposed = false;
    const notification = tour.current()?.id === 'notify';
    if (notification) void settingsView.open('notify').then(() => { if (!disposed) measure(); }).catch(() => { if (!disposed) next(); });
    else measure();
    bubble.current?.querySelector('button')?.focus();
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    window.addEventListener('resize', measure); document.addEventListener('scroll', measure, true); window.addEventListener('keydown', keys, true);
    return () => { disposed = true; cancelAnimationFrame(request); observer.disconnect(); window.removeEventListener('resize', measure); document.removeEventListener('scroll', measure, true); window.removeEventListener('keydown', keys, true); if (notification) settingsView.close(); };
  }, [tour, step]);

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
    signin: () => { setOffer(false); setError(''); setDialog(true); }, tour: start,
    manage: () => api.openLink('account'),
    signout: async () => { const r = await rpc('auth.signOut', {}, true); if (r.error) toast(r.error.message, true); await refresh(); },
  };
  const labels = { signin: 'Sign in', manage: 'Manage account', plan: planLabel(pro), tour: 'Take the tour', signout: 'Sign out' };
  const items = menuItems({ status, configured: look?.authConfigured, pro }).filter((id) => id !== 'who').flatMap((id) => [
    ...(id === 'signout' ? [{ type: 'divider' }] : []),
    { id, label: labels[id], isDisabled: id === 'plan', onClick: actions[id] },
  ]);
  const left = box ? Math.max(12, Math.min(innerWidth - 352, box.right + 16 + 336 <= innerWidth ? box.right + 16 : box.left - 352)) : 16;
  const top = box ? Math.max(12, Math.min(innerHeight - 300, box.top)) : 16;
  return <>
    {picture && icon ? createPortal(<img src={picture} alt="" width={20} height={20} data-personal referrerPolicy="no-referrer" onError={() => setBadPicture(picture)} />, icon) : null}
    <DropdownMenu placement="above" menuWidth={240} items={items} onOpenChange={(open) => { setMenuOpen(open); if (open) void api.addons().then((plugins) => setPro(Array.isArray(plugins) && plugins.some((p) => p.id === 'cc-pro' && p.enabled))).catch(() => {}); }} header={look?.authConfigured && status.signed_in ? <div className="cc-account-who" data-personal><Text>{status.name}</Text><Text color="secondary">{status.email}</Text></div> : undefined} renderTrigger={(trigger) => <RailTrigger trigger={trigger} />} />
    <Dialog isOpen={dialog} onOpenChange={(open) => { if (!open) cancelSignIn(); }} purpose="form" width={420} aria-label="Sign in to cc">
      <div className="cc-tour-content"><Heading level={2}>Sign in to cc</Heading><Text>An account is optional. Everything works without one.</Text>
        {waiting ? <Text role="status">Waiting for your browser...</Text> : null}
        {error ? <Text role="alert">{error}</Text> : null}
        <div className="cc-tour-actions"><Button variant="ghost" label="Cancel" onClick={cancelSignIn} /><Button variant="primary" label="Continue in browser" isDisabled={waiting} onClick={signIn} /></div>
      </div>
    </Dialog>
    {offer && !dialog && !tour ? <Card className="cc-tour-offer" padding={4} role="dialog" aria-label="Want the 1-minute tour?"><Byte /><div className="cc-tour-content"><Text>Want the 1-minute tour?</Text>{error ? <Text role="alert">{error}</Text> : null}<div className="cc-tour-actions"><Button variant="ghost" label="Not now" onClick={() => answer('later')} /><Button label="Yes" onClick={() => answer('yes')} /></div></div></Card> : null}
    {tour?.active ? <div className="cc-tour-running">
      <svg className="cc-tour-dimmer" width="100%" height="100%" aria-hidden="true"><path fillRule="evenodd" d={`M0 0H${innerWidth}V${innerHeight}H0Z ${box ? `M${box.left} ${box.top}V${box.bottom}H${box.right}V${box.top}Z` : ''}`} /></svg>
      <div ref={bubble} className="cc-tour-position" style={{ left, top }} role="dialog" aria-modal="true" aria-label="Tour" aria-describedby="cc-tour-line">
        <Byte label={tour.current()?.morph} /><Card padding={4}><div className="cc-tour-content"><Text id="cc-tour-line" aria-live="polite">{tour.current()?.line}</Text><div className="cc-tour-actions"><Button variant="ghost" label="Skip" onClick={() => tour.skip()} /><Text color="secondary">{tour.label()}</Text><Button label={tour.nextLabel()} onClick={next} /></div></div></Card>
      </div>
    </div> : null}
  </>;
}
