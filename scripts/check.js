const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const required = [
  "src/main/main.js",
  "src/main/preload.js",
  "src/renderer/index-premium.html",
  "src/renderer/styles-premium.css",
  "src/renderer/app-premium.js",
  "src/shared/rules.js",
  "src/shared/defaults.js",
  "src/main/supabaseService.js",
  "src/main/supabaseArtworkService.js",
  "src/main/supabaseAuthService.js",
  ".github/workflows/supabase-keepalive.yml",
  "supabase/migrations/20260609_project_keepalive.sql",
];

let ok = true;
for (const file of required) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) {
    console.error(`missing ${file}`);
    ok = false;
  }
}

function walk(dir, matches = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, matches);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      matches.push(full);
    }
  }
  return matches;
}

for (const file of walk(path.join(process.cwd(), "src"))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `syntax error ${file}`);
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log("Estrutura e sintaxe do app OK");
