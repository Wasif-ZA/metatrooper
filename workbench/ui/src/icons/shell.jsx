import React from 'react';
import { Icon } from './_icon.jsx';
import { SHAPES, progressRingSvg } from './shapes.js';

const shape = (name) => function ShellIcon({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><g dangerouslySetInnerHTML={{ __html: SHAPES[name] }} /></Icon>;
};

export const HomeIcon = shape('home');
export const CodeIcon = shape('code');
export const WallIcon = shape('wall');
export const InboxIcon = shape('inbox');
export const CalendarIcon = shape('calendar');
export const FolderIcon = shape('folder');
export const FolderAddIcon = shape('folderAdd');
export const PullRequestIcon = shape('pullRequest');
export const PlusIcon = shape('plus');
export const ChevronDownIcon = shape('chevronDown');
export const CoreDotIcon = shape('coreDot');
export const UsageIcon = shape('usage');
export const AddOnsIcon = shape('addOns');
export const FlagIcon = shape('flag');
export const SettingsIcon = shape('settings');
export const OurosMark = shape('mark1');
export const ChevronRightIcon = shape('chevronRight');
export const OrchestratorIcon = shape('orchestrator');
export const AttachIcon = shape('attach');
export const OptionsIcon = shape('options');
export const SendIcon = shape('send');
export const CommitIcon = shape('commit');
export const ChangesIcon = shape('changes');
export const RunIcon = shape('run');
export const ScheduleIcon = shape('schedule');
export const SortIcon = shape('sort');
export const ListViewIcon = shape('listView');
export const GridViewIcon = shape('gridView');
export const EmojiIcon = shape('emoji');
export const ApprovalIcon = shape('approval');
export const LearnIcon = shape('learn');
export const StepOpenIcon = shape('stepOpen');
export const StopIcon = shape('stop');
export const EngineIcon = shape('engine');

/** The sidebar's progress ring: arc = done/total, coloured by state (working, waiting, done, failed). */
export function ProgressRing({ state, done, total, size = 14, className, title }) {
  return <span className={className} style={{ display: 'inline-flex', flex: 'none' }} dangerouslySetInnerHTML={{ __html: progressRingSvg({ state, done, total, size, title }) }} />;
}
