#!/usr/bin/env node
// scripts/check-video-audio-stream.mjs
// v7.7.54 — 58th CI gate
// Validates every <video controls> in src/content/**/*.md + src/components/*.astro
// has an actual audio stream in its .mp4 source (or is marked data-video-only).
//
// Lesson: v7.7.52 video-caption-track gate added captions to <video controls> markup
// but never ffprobe'd the .mp4 source. Result: 2 silent screen recordings got
// captions describing fake audio (worse than silent-no-caption).
//
// 2-rule contract:
//   - video-controls-without-audio-stream-and-no-flag
//   - data-video-only-must-have-captions
//
// Skip rules:
//   - muted + autoplay+loop (decorative)
//   - <video> without controls attribute
//   - .mp4 not present locally (cross-origin only)
//
// Marker attributes:
//   - data-video-only="silent" — explicitly marked silent (no audio expected)
//   - data-video-only="external" — external URL, ffprobe skipped
//
// Usage:
//   node scripts/check-video-audio-stream.mjs

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIRS = ['src/content', 'src/components', 'src/pages'];
const PUBLIC_DIR = 'public';
const ISSUE_LIST = [];

const VIDEO_RE = /<video\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/video>)/gi;

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
    else if (/\.(md|astro|mdx)$/i.test(name)) checkFile(p);
  }
};

let videosScanned = 0;
let videosWithAudio = 0;
let videosMarkedSilent = 0;
let videosExternal = 0;
let videosSkippedNoControls = 0;

function checkFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  let m;
  VIDEO_RE.lastIndex = 0;
  while ((m = VIDEO_RE.exec(content)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const lineNum = lineOf(content, m.index);
    videosScanned++;

    // Skip if no controls attribute
    if (!/\bcontrols\b/i.test(attrs)) {
      videosSkippedNoControls++;
      continue;
    }

    // Skip if muted + autoplay+loop (decorative gallery)
    if (/\bmuted\b/i.test(attrs) && /\bautoplay\b/i.test(attrs) && /\bloop\b/i.test(attrs)) {
      continue;
    }

    // Check explicit markers
    const isVideoOnly = /data-video-only\s*=\s*["'](silent|external)["']/i.exec(attrs);
    if (isVideoOnly) {
      if (isVideoOnly[1].toLowerCase() === 'silent') {
        videosMarkedSilent++;
        // Verify NO captions on silent-only videos (captioned-silent is the bug we prevent)
        if (/<track\b/i.test(inner) && /kind\s*=\s*["']captions["']/i.test(inner)) {
          ISSUE_LIST.push({
            file: filePath,
            line: lineNum,
            snippet:
              'data-video-only="silent" has <track kind="captions"> — captioning silence misleads deaf/HoH users',
          });
        }
      } else {
        videosExternal++;
      }
      continue;
    }

    // Resolve src — local /proof/<file>.mp4 or /<base>/proof/<file>.mp4
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!srcMatch) {
      ISSUE_LIST.push({
        file: filePath,
        line: lineNum,
        snippet: '<video controls> has no src attribute',
      });
      continue;
    }

    const rawSrc = srcMatch[1];
    // Skip external URLs (http/https)
    if (/^https?:\/\//i.test(rawSrc)) {
      videosExternal++;
      continue;
    }

    // Strip base path prefix if present
    let localSrc = rawSrc.replace(/^\/portfolio/, '').replace(/^\//, '');
    const fullPath = join(PUBLIC_DIR, localSrc);

    try {
      statSync(fullPath);
    } catch {
      ISSUE_LIST.push({
        file: filePath,
        line: lineNum,
        snippet: `<video controls> src="${rawSrc}" not found locally at ${fullPath}`,
      });
      continue;
    }

    // ffprobe for audio stream
    let hasAudio = false;
    try {
      const out = execSync(
        `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${fullPath}"`,
        { stdio: 'pipe', timeout: 10000 },
      ).toString();
      hasAudio = out.trim().length > 0;
    } catch (e) {
      // ffprobe failed — flag as issue (likely not an mp4 or corrupt)
      ISSUE_LIST.push({
        file: filePath,
        line: lineNum,
        snippet: `<video controls> src="${rawSrc}" ffprobe failed — ${(e.message || '').slice(0, 80)}`,
      });
      continue;
    }

    if (hasAudio) {
      videosWithAudio++;
    } else {
      ISSUE_LIST.push({
        file: filePath,
        line: lineNum,
        snippet: `<video controls> src="${rawSrc}" has NO audio stream — either mux silent AAC, add data-video-only="silent", or remove controls attribute`,
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

for (const dir of SRC_DIRS) {
  visit(dir);
}

const total = ISSUE_LIST.length;
if (total === 0) {
  console.log(
    '=== Video-Audio-Stream Audit (v7.7.54) — every <video controls> has audio stream OR is explicitly marked ===',
  );
  console.log('');
  console.log(
    `Scanned ${videosScanned} <video> tag(s) · ${videosWithAudio} with audio stream · ${videosMarkedSilent} marked data-video-only="silent" · ${videosExternal} external · ${videosSkippedNoControls} skipped (no controls)`,
  );
  console.log('');
  console.log('✓ No silent videos masquerading as audio-bearing.');
  process.exit(0);
}

console.log('=== Video-Audio-Stream Audit (v7.7.54) ===');
console.log('');
console.log(`${total} issue(s):\n`);
for (const issue of ISSUE_LIST) {
  console.log(`  ${issue.file}:${issue.line}  ${issue.snippet}`);
}
console.log('');
console.log(
  'Fix: either mux silent AAC into the .mp4 (ffmpeg -f lavfi -i anullsrc -c:v copy -c:a aac), add data-video-only="silent" attribute, or remove controls attribute.',
);
process.exit(1);
