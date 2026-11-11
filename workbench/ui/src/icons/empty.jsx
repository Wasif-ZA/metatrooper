import React from 'react';
import { Icon } from './_icon.jsx';

export function NothingNeedsYou({ size = 64, className, title }) {
  return (
    <Icon {...{ size, className, title }}>
      <path d="m5.5 4 1.75 1.75 3.5-3.5" />
      <path d="m4 7.5-1.5 3v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2l-1.5-3" />
      <path d="M2.5 10.5h3l1 1h3l1-1h3" />
    </Icon>
  );
}
