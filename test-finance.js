// Test: directly call locateArtwork the same way the app does
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, 'runtime', 'data', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
console.log("Config:", JSON.stringify(config, null, 2));

// Manually replicate organizedRoot
const organizedRoot = config.panel50OrganizedRoot || "X:\\1 - TEMAS ORGANIZADOS";
console.log("organizedRoot:", organizedRoot);
console.log("Exists:", fs.existsSync(organizedRoot));

// Load syncService cache
const syncService = require('./src/main/syncService');
const cache = syncService.getCache(config);

const testId = process.argv[2] || '128';
const themeHint = cache.artworksMap?.[testId];
console.log("\nTest ID:", testId);
console.log("Cache themeHint:", themeHint);

if (themeHint && themeHint !== "true") {
  const expectedPath = path.join(organizedRoot, themeHint, testId);
  console.log("Expected path:", expectedPath);
  console.log("Path exists:", fs.existsSync(expectedPath));
  
  if (fs.existsSync(expectedPath)) {
    // Read files like getArtworkFiles does
    const SYSTEM_FILES = new Set(["thumbs.db", ".ds_store"]);
    let targetDir = expectedPath;
    const entries = fs.readdirSync(expectedPath, { withFileTypes: true });
    const pranchetas = entries.find(e => e.isDirectory() && e.name.toLowerCase() === "pranchetas");
    if (pranchetas) targetDir = path.join(expectedPath, pranchetas.name);
    
    const targetEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    const files = targetEntries
      .filter(e => e.isFile() && !SYSTEM_FILES.has(e.name.toLowerCase()) && !e.name.toLowerCase().endsWith(".ai"))
      .map(e => path.join(targetDir, e.name));
    
    console.log("\nFiles found:", files.length);
    files.forEach((f, i) => {
      const ext = path.extname(f).toLowerCase();
      console.log(`  ${i+1}. ${path.basename(f)} (${ext})`);
    });
    
    // Now test thumbnailForFile for each
    const { thumbnailForFile } = require('./src/main/fileService');
    console.log("\n--- Testing thumbnailForFile for each file ---");
    
    (async () => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = path.extname(file).toLowerCase();
        const t0 = Date.now();
        console.log(`\nFile ${i+1}/${files.length}: ${path.basename(file)} (${ext})`);
        try {
          const url = await thumbnailForFile(file, ext);
          console.log(`  Done in ${Date.now() - t0}ms, url length: ${url?.length}`);
        } catch (err) {
          console.error(`  ERROR in ${Date.now() - t0}ms:`, err.message);
        }
      }
      console.log("\n=== ALL DONE ===");
      process.exit(0);
    })();
  }
} else {
  // Fallback scan
  console.log("\nNo cache hint, doing fallback scan...");
  const themes = fs.readdirSync(organizedRoot, { withFileTypes: true });
  let found = false;
  for (const theme of themes) {
    if (!theme.isDirectory()) continue;
    const ep = path.join(organizedRoot, theme.name, testId);
    if (fs.existsSync(ep)) {
      console.log("Found in theme:", theme.name, "at", ep);
      found = true;
      break;
    }
  }
  if (!found) console.log("Not found in any theme.");
  process.exit(0);
}

setTimeout(() => {
  console.error("\n=== TIMEOUT after 30s - HUNG! ===");
  process.exit(2);
}, 30000);
