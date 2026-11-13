import React from 'react';
import { Icon } from './_icon.jsx';

export function Branch({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="4.5" r="1.5" /><path d="M4.5 5v6M11.5 6v1A3.5 3.5 0 0 1 8 10.5H6a1.5 1.5 0 0 0-1.5 1.5" /></Icon>;
}

export function RunLedger({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M3.5 13.5v-11h9v11L11 12l-1.5 1.5L8 12l-1.5 1.5L5 12l-1.5 1.5ZM6 5.5h4M6 8h4" /></Icon>;
}

export function Label({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M2.5 8 6 3.5h6.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6L2.5 8z" /><path d="M6.5 7.75v.5" /></Icon>;
}

export function Project({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><path d="M8 2.5 13 5.5v5L8 13.5 3 10.5v-5L8 2.5zM8 8v5.5M8 8 3 5.5M8 8l5-2.5" /></Icon>;
}
