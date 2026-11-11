import React from 'react';

function letterFor(id) {
  if (!id) return '?';
  const s = String(id).trim().toLowerCase();
  if (!s) return '?';
  if (s === 'claude') return 'C';
  if (s === 'codex') return 'X';
  if (s === 'gemini') return 'G';
  return Array.from(Array.from(s)[0].toUpperCase())[0];
}

export function EngineMark({ id, size = 16, className, title }) {
  const letter = letterFor(id);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 16 16" fill="none" className={className}
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      aria-label={title || undefined} focusable="false">
      {title ? <title>{title}</title> : null}
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" fillOpacity="0.12" />
      <text x="8" y="11.25" textAnchor="middle"
        fill="currentColor" fontSize="9" fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif">
        {letter}
      </text>
    </svg>
  );
}
