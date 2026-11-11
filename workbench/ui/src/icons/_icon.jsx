import React from 'react';

// Geometry lives on a 16 px grid; stroke weight scales with the requested size.
export function Icon({ size = 16, className, title, children }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      aria-label={title || undefined} focusable="false">
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
