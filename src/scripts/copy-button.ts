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
    color: var(--c-ink-2, #5a6473);
    background: var(--c-bg, #fff);
    border: 1px solid var(--c-rule, #c9ced6);
    /* v7.7.91 — chrome contract: rely on --j-r token (0px). */
    border-radius: var(--j-r, 0px);
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
      btn.style.color = 'var(--c-amber-light, #e8b220)';
      btn.style.borderColor = 'var(--c-amber-light, #e8b220)';
      window.setTimeout(() => {
        btn.textContent = 'Copy';
        btn.style.color = 'var(--c-ink-2, #5a6473)';
        btn.style.borderColor = 'var(--c-rule, #c9ced6)';
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
