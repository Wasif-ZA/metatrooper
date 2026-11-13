import React from 'react';
import { Icon } from './_icon.jsx';
import { SHAPES, projectIconHtml } from './shapes.js';

const shape = (name) => function ShellIcon({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><g dangerouslySetInnerHTML={{ __html: SHAPES[name] }} /></Icon>;
};

export const CodeIcon = shape('code');
export const WallIcon = shape('wall');
export const CalendarIcon = shape('calendar');
export const FolderIcon = shape('folder');
export const FolderAddIcon = shape('folderAdd');
export const PullRequestIcon = shape('pullRequest');
export const PlusIcon = shape('plus');
export const ChevronDownIcon = shape('chevronDown');
export const AddOnsIcon = shape('addOns');
export const ChevronRightIcon = shape('chevronRight');
export const OptionsIcon = shape('options');
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
export const Search = shape('search');
export const Filter = shape('filter');
export const Workspace = FolderIcon;
export const OpenOnWall = WallIcon;

/** A project's icon from snapshot projects[].icon (favicon, monogram, emoji or line icon); the same markup the sidebar draws. */
export function ProjectIcon({ icon, size = 14, className }) {
  return <span className={className} style={{ display: 'inline-flex', flex: 'none' }} dangerouslySetInnerHTML={{ __html: projectIconHtml(icon, size) }} />;
}
