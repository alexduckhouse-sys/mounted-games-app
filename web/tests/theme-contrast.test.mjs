import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = new URL('../src/', import.meta.url).pathname;
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const skin = stripComments(readFileSync(join(src, 'theme/skin.css'), 'utf8'));

/** The `--mg-*` channels each theme sets, with the base block filling in what a theme leaves out. */
function themeTokens() {
  const blocks = [...skin.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const read = (body) => Object.fromEntries([...body.matchAll(/--(mg-[a-z-]+):\s*(\d+) (\d+) (\d+);/g)].map(([, name, r, g, b]) => [name, [+r, +g, +b]]));
  const base = read(blocks.find((b) => b.selector.startsWith(':root, [data-theme="eguk"]')).body);
  const themes = { eguk: base };
  for (const { selector, body } of blocks) {
    const name = /^\[data-theme="([a-z]+)"\]$/.exec(selector)?.[1];
    if (name && name !== 'eguk') themes[name] = { ...base, ...read(body) };
  }
  return themes;
}

function luminance([r, g, b]) {
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('every theme is checked', () => {
  assert.deepEqual(Object.keys(themeTokens()).sort(), ['dark', 'eguk', 'light', 'ocean', 'sunset']);
});

test('solid buttons and pills reach 7:1 in every theme', () => {
  for (const [name, t] of Object.entries(themeTokens())) {
    const white = [255, 255, 255];
    assert.ok(contrast(t['mg-button'], white) >= 7, `${name}: --mg-button on white text is ${contrast(t['mg-button'], white).toFixed(2)}:1`);
    assert.ok(contrast(t['mg-danger'], white) >= 4.5, `${name}: --mg-danger with white text is ${contrast(t['mg-danger'], white).toFixed(2)}:1`);
  }
});

function cssFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith('.css') ? [path] : [];
  });
}

test('no rule puts white text on a --mg-heading or --mg-elim fill (pale in Stable Night)', () => {
  const offenders = [];
  for (const file of cssFiles(src)) {
    for (const [, selector, body] of stripComments(readFileSync(file, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const fill = /background(?:-color)?:\s*rgb\(var\(--mg-(heading|elim)\)\)/.test(body);
      const white = /(?:^|;|\s)color:\s*(#fff\b|#ffffff\b|white\b)/i.test(body);
      if (fill && white) offenders.push(`${file.slice(src.length)}: ${selector.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});
