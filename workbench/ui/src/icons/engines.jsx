import React from 'react';
import { engineMarkParts, engineMarkSvg } from './engine-marks.js';
import { engineName } from '../words.js';

globalThis.engineMarkSvg = engineMarkSvg;


export function EngineMark({ id, size = 16, className, title }) {
  const name = title || engineName(id);
  const t = name.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const { viewBox, inner } = engineMarkParts(id);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox={viewBox} preserveAspectRatio="xMidYMid" className={className} role="img" aria-label={name}
      focusable="false" dangerouslySetInnerHTML={{ __html: `<title>${t}</title>${inner}` }} />
  );
}
