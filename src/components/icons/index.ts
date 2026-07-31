/**
 * index.ts — STELLA custom SVG icon registry.
 *
 * Single source of truth for icon path resolution. Every icon lives in its
 * own file under `./icon-defs/` and exports a `SVG_PATH` string. This file
 * imports them all eagerly and exposes a typed `Record<IconName, string>`
 * plus a `getIconPath()` lookup function.
 *
 * Why explicit imports (vs `import.meta.glob`):
 *   - TypeScript exhaustiveness: adding a name to `IconName` without
 *     registering it here surfaces as a compile-time error.
 *   - Audit-friendly: every icon is one file. A reviewer can open one and
 *     verify the path data without scanning a generated object literal.
 *   - Bundle predictability: tree-shaking at the `tsc` / Astro build level
 *     removes unused icons when the consumer only references a subset.
 *
 * Per T1-2 binding fix (replaces the runtime `window.NAP.parts[key]`
 * registry model): this is build-time typed discovery, no `window`
 * pollution, SSR-safe.
 */

import { SVG_PATH as arrowRight } from './icon-defs/arrow-right';
import { SVG_PATH as arrowLeft } from './icon-defs/arrow-left';
import { SVG_PATH as arrowUp } from './icon-defs/arrow-up';
import { SVG_PATH as arrowDown } from './icon-defs/arrow-down';
import { SVG_PATH as chevronRight } from './icon-defs/chevron-right';
import { SVG_PATH as chevronDown } from './icon-defs/chevron-down';
import { SVG_PATH as menu } from './icon-defs/menu';
import { SVG_PATH as closeIcon } from './icon-defs/close';
import { SVG_PATH as externalLink } from './icon-defs/external-link';
import { SVG_PATH as check } from './icon-defs/check';
import { SVG_PATH as circleCheck } from './icon-defs/circle-check';
import { SVG_PATH as clock } from './icon-defs/clock';
import { SVG_PATH as alertTriangle } from './icon-defs/alert-triangle';
import { SVG_PATH as infoCircle } from './icon-defs/info-circle';
import { SVG_PATH as xCircle } from './icon-defs/x-circle';
import { SVG_PATH as book } from './icon-defs/book';
import { SVG_PATH as code } from './icon-defs/code';
import { SVG_PATH as document } from './icon-defs/document';
import { SVG_PATH as folder } from './icon-defs/folder';
import { SVG_PATH as link } from './icon-defs/link';
import { SVG_PATH as mail } from './icon-defs/mail';
import { SVG_PATH as message } from './icon-defs/message';
import { SVG_PATH as send } from './icon-defs/send';
import { SVG_PATH as github } from './icon-defs/github';
import { SVG_PATH as linkedin } from './icon-defs/linkedin';
import { SVG_PATH as briefcase } from './icon-defs/briefcase';
import { SVG_PATH as chartBar } from './icon-defs/chart-bar';
import { SVG_PATH as chartLine } from './icon-defs/chart-line';
import { SVG_PATH as lightbulb } from './icon-defs/lightbulb';
import { SVG_PATH as target } from './icon-defs/target';
import { SVG_PATH as trendingUp } from './icon-defs/trending-up';
import { SVG_PATH as sun } from './icon-defs/sun';
import { SVG_PATH as moon } from './icon-defs/moon';
import { SVG_PATH as globe } from './icon-defs/globe';
import { SVG_PATH as filter } from './icon-defs/filter';
import { SVG_PATH as search } from './icon-defs/search';
import { SVG_PATH as play } from './icon-defs/play';
import { SVG_PATH as pause } from './icon-defs/pause';

import type { IconName } from './types';

/**
 * The canonical registry — `Record<IconName, string>`.
 *
 * If you add a name to the IconName union but forget to register it here,
 * TypeScript will error at compile time. This is the contract that keeps
 * the icon library fully typed.
 */
export const PATHS: Record<IconName, string> = {
  'arrow-right': arrowRight,
  'arrow-left': arrowLeft,
  'arrow-up': arrowUp,
  'arrow-down': arrowDown,
  'chevron-right': chevronRight,
  'chevron-down': chevronDown,
  menu: menu,
  close: closeIcon,
  'external-link': externalLink,
  check: check,
  'circle-check': circleCheck,
  clock: clock,
  'alert-triangle': alertTriangle,
  'info-circle': infoCircle,
  'x-circle': xCircle,
  book: book,
  code: code,
  document: document,
  folder: folder,
  link: link,
  mail: mail,
  message: message,
  send: send,
  github: github,
  linkedin: linkedin,
  briefcase: briefcase,
  'chart-bar': chartBar,
  'chart-line': chartLine,
  lightbulb: lightbulb,
  target: target,
  'trending-up': trendingUp,
  sun: sun,
  moon: moon,
  globe: globe,
  filter: filter,
  search: search,
  play: play,
  pause: pause,
};

/**
 * Resolve a name → SVG path string at runtime.
 *
 * Accepts the narrowed `IconName` type. A typo at a call site
 * (`getIconPath('arrow-riight')`) is caught at TypeScript compile time
 * because `arrow-riight` is not assignable to `IconName`.
 */
export function getIconPath(name: IconName): string {
  return PATHS[name];
}

export type { IconName } from './types';
export { ICON_NAMES, ICON_SIZE_CHROME, ICON_SIZE_CONTENT } from './types';
