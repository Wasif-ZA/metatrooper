'use strict';

const cursor = document.getElementById('cursor');
let started = false;

window.cursorAt = () => {
  const r = cursor.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

window.overlayBridge.onCursor(({ x, y, ease }) => {
  cursor.hidden = false;
  cursor.style.transitionDuration = started ? `${ease}ms` : '0ms';
  started = true;
  cursor.style.transform = `translate(${x}px, ${y}px)`;
  cursor.classList.remove('pulse');
  setTimeout(() => cursor.classList.add('pulse'), ease);
});
