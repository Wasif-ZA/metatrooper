import React from 'react';
import { Icon } from './_icon.jsx';

const draw = (body) => function ScreenIcon({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}>{body}</Icon>;
};

export const SplitIcon = draw(<><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M8 3v10" /></>);
export const TrashIcon = draw(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.25a1 1 0 0 0 1 .75h3.8a1 1 0 0 0 1-.75l.6-8.25" />);
export const BracesIcon = draw(<path d="M6 3H5.5A1.5 1.5 0 0 0 4 4.5V7L3 8l1 1v2.5A1.5 1.5 0 0 0 5.5 13H6M10 3h.5A1.5 1.5 0 0 1 12 4.5V7l1 1-1 1v2.5a1.5 1.5 0 0 1-1.5 1.5H10" />);
export const MoreIcon = draw(<><circle cx="3.5" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12.5" cy="8" r=".9" fill="currentColor" /></>);
export const ChevronUpIcon = draw(<path d="m4.5 9.5 3.5-3.5 3.5 3.5" />);
export const CloseIcon = draw(<path d="m4.5 4.5 7 7m0-7-7 7" />);
export const CheckIcon = draw(<path d="m3 8 3 3 7-7" />);
export const CircleXIcon = draw(<><circle cx="8" cy="8" r="5.5" /><path d="m6 6 4 4m0-4-4 4" /></>);
export const WarningIcon = draw(<><path d="M8 2.5 14 13H2zM8 6v3.5" /><circle cx="8" cy="11.25" r=".25" /></>);
export const DiffIcon = draw(<><path d="M3 3h10v10H3zM5 6h6M8 4v4M5 10.5h6" /></>);
export const MinusIcon = draw(<path d="M3.5 8h9" />);
export const MailIcon = draw(<><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" /><path d="m2.5 5 5.5 3.5L13.5 5" /></>);
export const ArchiveIcon = draw(<><rect x="2.5" y="3" width="11" height="3" rx="1" /><path d="M3.5 6v6.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V6M6.5 9h3" /></>);
export const ExternalLinkIcon = draw(<path d="M7 3.5H4.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9M9.5 3.5h3v3M12.5 3.5l-5 5" />);
export const ReloadIcon = draw(<path d="M12.5 8a4.5 4.5 0 1 1-1.32-3.18M12.5 2.75v2.5H10" />);
export const UndoIcon = draw(<path d="M5.5 3.5 3 6l2.5 2.5M3 6h6.5a3 3 0 0 1 0 6H7" />);
export const TerminalIcon = draw(<path d="m3.5 4.5 3 3.5-3 3.5M8.5 11.5h4" />);
export const FileIcon = draw(<path d="M9.5 2.5h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7zM9.5 2.5v3h3" />);
export const JsonIcon = draw(<path d="M5.5 3H5a1.5 1.5 0 0 0-1.5 1.5v1.75L2.5 8l1 1.75v1.75A1.5 1.5 0 0 0 5 13h.5M10.5 3h.5a1.5 1.5 0 0 1 1.5 1.5v1.75l1 1.75-1 1.75v1.75A1.5 1.5 0 0 1 11 13h-.5" />);
export const MarkdownIcon = draw(<><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" /><path d="M4 10V6l2 2.25L8 6v4M11.5 6v4M10 8.5l1.5 1.5L13 8.5" /></>);
export const CssIcon = draw(<path d="M6.5 2.5 5 13.5M11 2.5 9.5 13.5M3 6h10.5M2.5 10H13" />);
export const TsIcon = draw(<path d="M2 4.5h5M4.5 4.5v7.5M13.5 5.25c-.35-.5-1-.75-1.75-.75-1.1 0-1.9.6-1.9 1.5 0 2.1 3.9 1.1 3.9 3.3 0 1-.85 1.7-2.05 1.7-.9 0-1.7-.4-2.1-1" />);
export const JsIcon = draw(<path d="M6.5 4.5v5.25a2 2 0 0 1-4 0M13.5 5.25c-.35-.5-1-.75-1.75-.75-1.1 0-1.9.6-1.9 1.5 0 2.1 3.9 1.1 3.9 3.3 0 1-.85 1.7-2.05 1.7-.9 0-1.7-.4-2.1-1" />);
export const PyIcon = draw(<><path d="M2.5 12V4.5h2.25a2 2 0 0 1 0 4H2.5" /><path d="m8.5 4.5 2.5 4 2.5-4M11 8.5V12" stroke="var(--lang-py2, currentColor)" /></>);
export const HtmlIcon = draw(<path d="M5 5 2 8l3 3M11 5l3 3-3 3M9.25 3.5l-2.5 9" />);
export const TextIcon = draw(<path d="M9.5 2.5h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7zM9.5 2.5v3h3M5.75 8.5h4.5M5.75 11h3" />);
export const ImageIcon = draw(<><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><circle cx="6" cy="6" r="1.25" /><path d="m13.5 10.5-3-3-7 6" /></>);
export const SavingsIcon = draw(<path d="M8 2v12M11 5c-.5-.9-1.6-1.5-3-1.5-1.8 0-3 .9-3 2.25 0 3.25 6 1.5 6 4.5 0 1.4-1.3 2.25-3.2 2.25-1.5 0-2.7-.6-3.3-1.6" />);
export const LockIcon = draw(<><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2M8 9.75v1.5" /></>);
export const BellIcon = draw(<path d="M4 10.5V7a4 4 0 0 1 8 0v3.5l1.5 2h-11zM6.5 14.25h3" />);
