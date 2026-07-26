/**
 * odometer.ts — Phase D-1.
 *
 * Animates [data-counter="N"] once when scrolled into view. Counter goes
 * from 0 → N over 1.2s with an ease-out cubic-bezier curve. Monospace
 * tabular-nums prevents layout shift. One-shot per element.
 *
 * v6.18 — fix 0-flash. SSR renders the formatted final value (not 0),
 * so we DON'T reset to '0' on init. Only when the IO fires AND the
 * element is in viewport do we start the count-up. Threshold also
 * dropped from 0.3 → 0 so a cell that's partially visible animates
 * immediately (the hero stats live near the top of the page).
 *
 * v7.6.8 — prefix/suffix preservation. The element's initial text
 * is parsed for a leading prefix (anything before the first digit,
 * preserving currency tickers, sign glyphs, ~, ≈) and a trailing
 * suffix (anything after the last digit, preserving %, x, bps, k).
 * The animation only mutates the numeric middle; the prefix/suffix
 * stay glued in place. If the text can't be parsed (no digits),
 * the element is left untouched.
 *
 * Honors prefers-reduced-motion (instant snap to final value).
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface ParsedText {
  prefix: string;
  suffix: string;
  numericFinal: number;
  decimals: number;
}

/**
 * Split "+12.0%" into ["", "+", "12.0", "%"] or "≈ 0.39" into
 * ["≈ ", "", "0.39", ""]. The regex is intentionally permissive:
 * the leading cluster is anything non-digit; the trailing cluster
 * is anything non-digit, non-letter-from-bps-mnemonics.
 *
 * Decimals preserved from the final numeric string so the
 * intermediate frames render with the same precision.
 */
function parseText(text: string, target: number): ParsedText | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Find the numeric portion in the original text — match any number,
  // then rebuild the prefix/suffix around `target` on every animation
  // frame so the rendered text stays composed while only the digits
  // tick.
  const m = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const start = m.index ?? 0;
  const end = start + m[0].length;
  const prefix = trimmed.slice(0, start);
  const suffix = trimmed.slice(end);
  const decimals = m[0].includes('.') ? m[0].split('.')[1].length : 0;
  return { prefix, suffix, numericFinal: target, decimals };
}

function formatNumber(value: number, decimals: number): string {
  return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals);
}

function init(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-counter]');
  if (targets.length === 0) return;

  targets.forEach((el) => {
    const finalStr = el.dataset.counter ?? '0';
    const final = Number.parseFloat(finalStr);
    if (!Number.isFinite(final)) return;

    const parsed = parseText(el.textContent ?? '', final);
    if (!parsed) return; // no numeric target in text — leave alone

    if (reduced || !('IntersectionObserver' in window)) {
      // Already SSR'd to the final value — leave it.
      return;
    }

    // Allow per-element duration override via `data-duration` (ms).
    const overrideDur = Number.parseFloat(el.dataset.duration ?? '');
    const duration = Number.isFinite(overrideDur) && overrideDur > 0 ? overrideDur : 1200;
    const start = performance.now();
    let fired = false;

    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = final * eased;
      el.textContent = `${parsed.prefix}${formatNumber(current, parsed.decimals)}${parsed.suffix}`;
      if (t < 1) requestAnimationFrame(animate);
      else el.textContent = `${parsed.prefix}${formatNumber(final, parsed.decimals)}${parsed.suffix}`;
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !fired) {
            fired = true;
            // Reset to 0 RIGHT BEFORE the animation starts (not on
            // init). Eliminates the "0 flash" — prefix/suffix
            // preserved around the animated digits.
            el.textContent = `${parsed.prefix}${formatNumber(0, parsed.decimals)}${parsed.suffix}`;
            requestAnimationFrame(animate);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0 },
    );
    io.observe(el);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
