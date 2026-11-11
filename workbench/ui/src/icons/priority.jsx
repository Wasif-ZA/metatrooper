import React from 'react';
import { Icon } from './_icon.jsx';

export function None({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M3 8h1.5M7.25 8h1.5M11.5 8H13" opacity="0.3" /></Icon>;
}

function Bars({ level, ...props }) {
  return <Icon {...props}>
    <rect x="3" y="10" width="2" height="3" rx="0.5" />
    <rect x="7" y="7" width="2" height="6" rx="0.5" opacity={level >= 2 ? 1 : 0.3} />
    <rect x="11" y="3" width="2" height="10" rx="0.5" opacity={level >= 3 ? 1 : 0.3} />
  </Icon>;
}

export function Low({ size = 16, className, title }) {
  return <Bars level={1} {...{ size, className, title }} />;
}

export function Medium({ size = 16, className, title }) {
  return <Bars level={2} {...{ size, className, title }} />;
}

export function High({ size = 16, className, title }) {
  return <Bars level={3} {...{ size, className, title }} />;
}

export function Urgent({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M8 5.25v3.5" /><circle cx="8" cy="11" r="0.75" fill="currentColor" stroke="none" /></Icon>;
}
