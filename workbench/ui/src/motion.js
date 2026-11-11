// From t3code (MIT), apps/web/src/components/Sidebar.motion.ts
const motionTiming = { duration: 150, easing: 'ease-out' };
// From t3code (MIT), apps/web/src/components/Sidebar.motion.ts
const rowTravel = (height) => Math.min(height, 40);

const calm = () => typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
export const canMove = (el) => Boolean(el && typeof el.animate === 'function') && !calm();

export function stagger(nodes, travel = 6) {
  [...nodes].slice(0, 12).forEach((n, i) => n.animate(
    [{ opacity: 0, transform: `translateY(${-Math.min(travel, rowTravel(n.offsetHeight))}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
    { ...motionTiming, delay: i * 20, fill: 'backwards' },
  ));
}

export function reveal(el, rows = ':scope li') {
  if (typeof el?.getAnimations === 'function') el.getAnimations().forEach((a) => a.cancel());
  if (!canMove(el)) return;
  el.animate([{ height: '0px', opacity: 0 }, { height: `${el.scrollHeight}px`, opacity: 1 }], { ...motionTiming, duration: 180 });
  stagger(el.querySelectorAll(rows));
}

export function conceal(el, done) {
  if (!canMove(el)) return done();
  const a = el.animate([{ height: `${el.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { ...motionTiming, fill: 'forwards' });
  a.onfinish = () => { done(); requestAnimationFrame(() => a.cancel()); };
}

export function crossfade(el, ghost) {
  if (!canMove(el)) return;
  if (ghost) {
    Object.assign(ghost.style, { position: 'absolute', inset: '0 0 auto 0', pointerEvents: 'none' });
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    el.parentNode.insertBefore(ghost, el);
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], motionTiming).onfinish = () => ghost.remove();
  }
  el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0px)' }], { ...motionTiming, delay: ghost ? 40 : 0, fill: 'backwards' });
}
