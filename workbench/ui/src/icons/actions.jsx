import React from 'react';
import { Icon } from './_icon.jsx';

export function Answer({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M12.5 12v-1a3.5 3.5 0 0 0-3.5-3.5H3.5m3-3L3.5 7.5l3 3" /></Icon>;
}

export function NewSubTask({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M8 5.5v5M5.5 8h5" /></Icon>;
}

export function PanelToggle({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M10 2.5v11" /></Icon>;
}

export function ExpandIcon({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" /></Icon>;
}

export function ReturnIcon({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M12.5 3v4.5a2 2 0 0 1-2 2h-7m3-3-3 3 3 3" /></Icon>;
}

export function LaptopIcon({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><rect x="3" y="3.5" width="10" height="7" rx="1" /><path d="M1.5 12.5h13" /></Icon>;
}
