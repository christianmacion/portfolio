/**
 * recent-moves.ts : canonical record of recent user-facing URL moves.
 *
 * Sourced from git history (`git log --diff-filter=DR -- src/pages/`) —
 * only includes moves that affected visitor-visible routes, NOT
 * component-file reshuffles (those go to /_archive/ which is excluded).
 *
 * Used by:
 *   - 404.astro : the "recently moved" recovery list. Visitors who hit
 *     a stale link see old URL → new URL + the reason it moved.
 *
 * Add a new entry when:
 *   1. A page is renamed (old URL no longer serves a 200).
 *   2. A page is deleted and its content has been merged into another route.
 *   3. A page is split / consolidated.
 *
 * Do NOT add entries for:
 *   - Component moves (live under /_archive/, not user-visible).
 *   - Markdown content-collection renames (URL routes are unchanged).
 *   - Planned moves that haven't shipped yet.
 *
 * Entry shape:
 *   - oldPath : the URL that no longer resolves (or never resolved as a
 *     live route).
 *   - newPath : where the content lives now. `null` if removed entirely
 *     with no replacement.
 *   - movedAt : ISO date the change shipped.
 *   - reason : one-line plain-language note for the visitor. No internal
 *     jargon; no commit hashes.
 */
export interface RecentMove {
  oldPath: string;
  newPath: string | null;
  movedAt: string;
  reason: string;
}

export const recentMoves: ReadonlyArray<RecentMove> = [
  {
    oldPath: '/chat',
    newPath: '/proof',
    movedAt: '2026-07-09',
    reason: 'The TF-IDF RAG widget retired. The same harness now lives at /proof as an OSS artifact.',
  },
  {
    oldPath: '/projects/quant',
    newPath: '/projects/quant/',
    movedAt: '2026-08-01',
    reason: 'Quant lane index page shipped. The trailing slash now resolves to the deep-dive route.',
  },
];
