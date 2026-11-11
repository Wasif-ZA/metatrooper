import React from 'react';
import { Icon } from './_icon.jsx';

// All seven states share the same centre and 5.5 px ring radius.
export function NeedsYou({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" /></Icon>;
}

// Apply rotation through className; the SVG box rotates around its centre.
export function Working({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="8" cy="8" r="5.5" opacity="0.3" /><path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" /></Icon>;
}

export function Blocked({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="8" cy="8" r="5.5" /><path d="m4.1 11.9 7.8-7.8" /></Icon>;
}

export function InReview({ size = 16, className, title }) {
  // Close hatching describes the right half without introducing a solid fill.
  return <Icon {...{ size, className, title }}><circle cx="8" cy="8" r="5.5" /><path d="M8.75 3.25v9.5M10.5 3.9v8.2M12.25 5.6v4.8" /></Icon>;
}

export function Failed({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="8" cy="8" r="5.5" /><path d="m6.25 6.25 3.5 3.5m0-3.5-3.5 3.5" /></Icon>;
}

export function Done({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><circle cx="8" cy="8" r="5.5" /><path d="m5.5 8 1.75 1.75 3.5-3.5" /></Icon>;
}

export function Starting({ size = 16, className, title }) {
  // Explicit arc dashes keep the same ring radius in SVG rasterizers as well.
  return <Icon {...{ size, className, title }}>{Array.from({ length: 8 }, (_, i) =>
    <path key={i} d="M7.045 2.584a5.5 5.5 0 0 1 1.91 0" transform={`rotate(${i * 45} 8 8)`} />
  )}</Icon>;
}
