#!/usr/bin/env node
// scripts/check-video-caption-track.mjs
// v7.7.52 — 56th CI gate (a11y)
// Validates every <video> in dist/*.html has <track kind="captions"> child IF
// the video has audio (i.e. is NOT muted decorative loop).
// WCAG 1.2.2 Captions (Prerecorded) — Level A.
//
// Skip rules:
//   - <video muted> — autoplay decorative loops are exempt (no synchronized audio)
//   - <video> without controls AND without autoplay AND without src="...audio..." —
//     effectively unused; treat as muted
//   - /workbooks/*.html
//
// 1-rule contract: video-with-audio-without-captions

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const ISSUE_LIST = [];

const visit = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) visit(p);
    else if (name.endsWith('.html')) checkFile(p);
  }
};

let videoFilesScanned = 0;
let videosScanned = 0;
let videosWithAudio = 0;

function checkFile(filePath) {
  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  if (filePath.includes('/workbooks/')) return;
  videoFilesScanned++;

  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');

  // Match each <video>...</video> (self-close OR open/close)
  const videoRe = /<video\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/video>)/gi;
  let m;
  while ((m = videoRe.exec(stripped)) !== null) {
    videosScanned++;
    const attrs = m[1] || '';
    const inner = m[2] || '';

    // Check muted
    const isMuted = /\bmuted\b/i.test(attrs) || /\bmuted\s*=\s*["']true["']/i.test(attrs);

    // Check autoplay
    const isAutoplay = /\bautoplay\b/i.test(attrs) || /\bautoplay\s*=\s*["']true["']/i.test(attrs);

    // Decorative: muted OR autoplay+loop with no audio track
    // We treat muted as the strongest indicator of "no audio"
    const isDecorative = isMuted || (isAutoplay && /\bloop\b/i.test(attrs));

    if (isDecorative) continue;

    // Non-decorative video — must have captions
    videosWithAudio++;
    const hasCaptions = /<track\b[^>]*\bkind\s*=\s*["']captions["']/i.test(inner);

    if (!hasCaptions) {
      ISSUE_LIST.push({
        file: filePath,
        line: lineOf(html, m.index),
        src: (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '?',
      });
    }
  }
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) {
    if (haystack.charCodeAt(i) === 10) line++;
  }
  return line;
}

visit(DIST);

const total = ISSUE_LIST.length;
if (total === 0) {
  console.log(
    '=== Video-Caption-Track Audit (v7.7.52) — every non-decorative <video> must have <track kind="captions"> ===',
  );
  console.log('');
  console.log(
    `Scanned ${videoFilesScanned} HTML page(s) · ${videosScanned} <video> tag(s) · ${videosWithAudio} with audio · 0 without captions · 0 issue(s)`,
  );
  console.log('');
  console.log('✓ All non-decorative videos across dist/*.html have caption tracks (WCAG 1.2.2).');
  console.log('');
  process.exit(0);
}

console.log('=== Video-Caption-Track Audit (v7.7.52) ===');
console.log('');
console.log(`${total} video(s) with audio but without captions:\n`);
for (const issue of ISSUE_LIST) {
  console.log(`  ${issue.file}:${issue.line}  src="${issue.src}"`);
}
console.log('');
console.log(
  'Fix: add `<track kind="captions" src="...vtt" srclang="en" label="English">` as child of <video>.',
);
console.log('Skip rules: muted / autoplay+loop / /workbooks/*.');
process.exit(1);
