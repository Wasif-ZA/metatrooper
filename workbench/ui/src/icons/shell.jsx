import React from 'react';
import { Icon } from './_icon.jsx';
import { SHAPES, progressRingSvg } from './shapes.js';

const shape = (name) => function ShellIcon({ size = 16, className, title }) {
  return <Icon {...{ size, className, title }}><g dangerouslySetInnerHTML={{ __html: SHAPES[name] }} /></Icon>;
};

export const Home = shape('home');
export const Code = shape('code');
export const Wall = shape('wall');
export const Inbox = shape('inbox');
export const Calendar = shape('calendar');
export const Folder = shape('folder');
export const FolderAdd = shape('folderAdd');
export const PullRequest = shape('pullRequest');
export const Plus = shape('plus');
export const ChevronDown = shape('chevronDown');
export const CoreDot = shape('coreDot');
export const Usage = shape('usage');
export const AddOns = shape('addOns');
export const Flag = shape('flag');
export const Settings = shape('settings');
export const OurosMark = shape('mark1');
export const ChevronRight = shape('chevronRight');
export const Orchestrator = shape('orchestrator');
export const Attach = shape('attach');
export const Options = shape('options');
export const Send = shape('send');
export const Commit = shape('commit');
export const Changes = shape('changes');
export const Run = shape('run');
export const Schedule = shape('schedule');
export const Sort = shape('sort');
export const ListView = shape('listView');
export const GridView = shape('gridView');
export const Emoji = shape('emoji');
export const Approval = shape('approval');
export const Learn = shape('learn');
export const StepOpen = shape('stepOpen');
export const Stop = shape('stop');
export const Engine = shape('engine');

/** The sidebar's progress ring: arc = done/total, coloured by state (working, waiting, done, failed). */
export function ProgressRing({ state, done, total, size = 14, className, title }) {
  return <span className={className} style={{ display: 'inline-flex', flex: 'none' }} dangerouslySetInnerHTML={{ __html: progressRingSvg({ state, done, total, size, title }) }} />;
}
