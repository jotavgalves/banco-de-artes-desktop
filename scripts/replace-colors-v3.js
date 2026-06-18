const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles-premium.css');
let css = fs.readFileSync(cssPath, 'utf-8');

const replacements = [
  ['--primary:#3b82f6', '--primary:#3b82f6'],
  ['--primary2:#2563eb', '--primary2:#2563eb'],
  ['--primarySoft:#eff6ff', '--primarySoft:#eff6ff'],
  ['var(--primary)', 'var(--primary)'],
  ['var(--primary2)', 'var(--primary2)'],
  ['var(--primarySoft)', 'var(--primarySoft)'],
  ['rgba(59,130,246', 'rgba(59,130,246'],
  ['#bfdbfe', '#bfdbfe'],
  ['#93c5fd', '#93c5fd'],
  ['#f8fafc', '#f8fafc'],
];

let count = 0;
for (const [target, replacement] of replacements) {
  const parts = css.split(target);
  if (parts.length > 1) {
    count += parts.length - 1;
    css = parts.join(replacement);
  }
}

fs.writeFileSync(cssPath, css, 'utf-8');
console.log(`Blue palette normalization complete (${count} token occurrences checked).`);
