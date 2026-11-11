import React from 'react';
import { engineMarkInner, engineMarkSvg, engineName } from './engine-marks.js';

globalThis.engineMarkSvg = engineMarkSvg;

export { engineName };

export function EngineMark({ id, size = 16, className, title }) {
  const name = title || engineName(id);
  const t = name.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 16 16" className={className} role="img" aria-label={name}
      focusable="false" dangerouslySetInnerHTML={{ __html: `<title>${t}</title>${engineMarkInner(id)}` }} />
  );
}
