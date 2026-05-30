const fs = require("node:fs");
const path = require("node:path");

const required = [
  "src/main/main.js",
  "src/main/preload.js",
  "src/renderer/index-premium.html",
  "src/renderer/styles-premium.css",
  "src/renderer/app-premium.js",
  "src/shared/rules.js",
  "src/shared/defaults.js",
];

let ok = true;
for (const file of required) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) {
    console.error(`missing ${file}`);
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log("Estrutura do app OK");
