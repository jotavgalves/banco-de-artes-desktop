const fs = require('fs');

const cssPath = 'src/renderer/styles-premium.css';
let css = fs.readFileSync(cssPath, 'utf-8');

const replacements = {
  '--primary:#3b82f6': '--primary:#3b82f6',
  '--primary2:#2563eb': '--primary2:#2563eb',
  '--primarySoft:#eff6ff': '--primarySoft:#eff6ff',
  '--line:#e2e8f0': '--line:#e2e8f0',
  '--simple-accent: #2563eb': '--simple-accent: #2563eb',
};

let count = 0;
for (const [target, replacement] of Object.entries(replacements)) {
  const next = css.split(target).join(replacement);
  if (next !== css) count += 1;
  css = next;
}

fs.writeFileSync(cssPath, css);
console.log(`Blue palette normalization complete (${count} token groups checked).`);
