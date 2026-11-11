import React from 'react';
import { Icon } from './_icon.jsx';

export function Parent({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><rect x="5.5" y="2.5" width="5" height="3" rx="1" /><path d="M8 5.5v4M3.5 13v-2.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V13" /></Icon>;
}

export function SubTasks({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M3.5 3.5h9M3.5 3.5v6.5a2 2 0 0 0 2 2H12.5M5.5 8H12.5" /></Icon>;
}

export function BlockedBy({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M2.5 8h7m-2.5-2.5L9.5 8 7 10.5M13.5 4v8" /></Icon>;
}

export function Blocking({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M2.5 4v8M6.5 8h7M11 5.5 13.5 8 11 10.5" /></Icon>;
}

export function Reviewer({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M2 8s2.5-4.5 6-4.5 6 4.5 6 4.5-2.5 4.5-6 4.5S2 8 2 8z" /><circle cx="8" cy="8" r="1.75" /></Icon>;
}

export function Approver({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M8 2.5 3 4.5v3c0 2.75 2 4.75 5 6 3-1.25 5-3.25 5-6v-3L8 2.5zm-2 5.25 1.5 1.5 3-3" /></Icon>;
}

export function Monitor({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M2 8.5h2.75l2-4.5 2.5 8.5 2-4H14" /></Icon>;
}

export function Workspace({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 2h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5z" /></Icon>;
}

export function Branch({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="4.5" r="1.5" /><path d="M4.5 5v6M11.5 6v1A3.5 3.5 0 0 1 8 10.5H6a1.5 1.5 0 0 0-1.5 1.5" /></Icon>;
}

export function Service({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11" /><ellipse cx="8" cy="8" rx="2.75" ry="5.5" /></Icon>;
}

export function RunLedger({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M3.5 13.5v-11h9v11L11 12l-1.5 1.5L8 12l-1.5 1.5L5 12l-1.5 1.5ZM6 5.5h4M6 8h4" /></Icon>;
}

export function Label({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M2.5 8 6 3.5h6.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6L2.5 8z" /><path d="M6.5 7.75v.5" /></Icon>;
}

export function Assignee({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="8" cy="5.25" r="2.25" /><path d="M3.75 13.5c0-2.35 1.9-4.25 4.25-4.25s4.25 1.9 4.25 4.25" /></Icon>;
}

export function Project({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M8 2.5 13 5.5v5L8 13.5 3 10.5v-5L8 2.5zM8 8v5.5M8 8 3 5.5M8 8l5-2.5" /></Icon>;
}
