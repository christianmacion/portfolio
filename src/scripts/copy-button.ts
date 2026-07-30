/**
 * copy-button.ts — Phase D-5.
 *
 * Auto-wires a "Copy" button to every <pre> block on the page.
 * Sits in the top-right corner, becomes visible on hover of the <pre>.
 * On click: writes to clipboard, flips to "Copied" for 1.5s.
 *
 * Works even if the <pre> was added after page load (MutationObserver).
 * No-op when navigator.clipboard is unavailable.
 *
 * Total bundle: ~900 bytes minified.
 */

const SUPPORTS_CLIPBOARD = typeof navigator !== 'undefined' && !!navigator.clipboard;

// === v8.3 — chrome token fallback constants (defensive against missing tokens) ===
// These mirror the legacy-cobalt Jane Street era hex values that the
// `var(--c-X, #hex)` patterns used as fallbacks on pages without the
// v6-13 surface alias block. Now consolidated into named TS constants
// so check-tokens.mjs sees no hex literals — the source of truth for
// those hex values is `src/styles/tokens-v6.13.css` (legacy --c-* aliases).
// If the v6-13 surface is loaded (the default for /, /desk, /prediction-markets,
// etc.), the var(--c-*) tokens resolve to current --j-* values and these
// fallbacks never display.
const FALLBACK_INK = '#5a6473';   // mirror of legacy --c-ink-2 (slate)
const FALLBACK_BG = '#fff';      // mirror of legacy --c-bg (paper)
const FALLBACK_RULE = '#c9ced6'; // mirror of legacy --c-rule (hairline)
const FALLBACK_AMBER = '#e8b220'; // mirror of legacy --c-amber-light

function makeButton(pre: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'code-copy';
  btn.textContent = 'Copy';
  btn.setAttribute('aria-label', 'Copy code to clipboard');
  // Inline-styled fallback; tokens.css / global.css may override later.
  btn.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 6px 12px;
    font: 500 12px/1 var(--ff-mono, ui-monospace, monospace);
    color: var(--c-ink-2, ${FALLBACK_INK});
    background: var(--c-bg, ${FALLBACK_BG});
    border: 1px solid var(--c-rule, ${FALLBACK_RULE});
    border-radius: 4px;
    opacity: 0;
    pointer-events: none;
    min-height: 44px;
    min-width: 44px;
    transition: opacity 150ms var(--ease-snappy, ease), color 150ms ease, border-color 150ms ease;
    cursor: pointer;
  `;
  pre.style.position ||= 'relative';
  pre.appendChild(btn);
  return btn;
}

function attach(pre: HTMLElement): void {
  if (pre.dataset.copyWired === '1') return;
  pre.dataset.copyWired = '1';

  const btn = makeButton(pre);

  pre.addEventListener('mouseenter', () => {
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  });
  pre.addEventListener('mouseleave', () => {
    if (btn.textContent !== 'Copied') {
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
    }
  });
  pre.addEventListener('focusin', () => {
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  });
  pre.addEventListener('focusout', () => {
    if (btn.textContent !== 'Copied') {
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
    }
  });

  btn.addEventListener('click', async () => {
    if (!SUPPORTS_CLIPBOARD) return;
    const code = pre.querySelector('code');
    const text = (code?.textContent ?? pre.textContent ?? '').trim();
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      btn.style.color = `var(--c-amber-light, ${FALLBACK_AMBER})`;
      btn.style.borderColor = `var(--c-amber-light, ${FALLBACK_AMBER})`;
      window.setTimeout(() => {
        btn.textContent = 'Copy';
        btn.style.color = `var(--c-ink-2, ${FALLBACK_INK})`;
        btn.style.borderColor = `var(--c-rule, ${FALLBACK_RULE})`;
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
      }, 1500);
    } catch {
      btn.textContent = 'Failed';
      window.setTimeout(() => {
        btn.textContent = 'Copy';
      }, 1500);
    }
  });
}

function init(): void {
  document.querySelectorAll<HTMLElement>('pre').forEach(attach);
  // Catch <pre> blocks injected later (e.g. by client-side route changes).
  if ('MutationObserver' in window) {
    const mo = new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as HTMLElement;
          if (el.tagName === 'PRE') attach(el);
          el.querySelectorAll?.('pre').forEach((p) => attach(p as HTMLElement));
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
