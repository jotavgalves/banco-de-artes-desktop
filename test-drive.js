const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function run() {
  const config = JSON.parse(fs.readFileSync('C:\\BancoDeArtes\\artbank-config.json', 'utf8'));
  const credentialsPath = config.credentialsPath || path.join(__dirname, "src/main/credentials.json");
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
  const drive = google.drive({ version: "v3", auth });

  // Let's find the first theme folder that has imageCount: 2 in the cache
  const cache = JSON.parse(fs.readFileSync('C:\\BancoDeArtes\\drive-folder-cache.json', 'utf8'));
  let targetFolder = null;
  for (const key in cache.themes) {
    if (cache.themes[key].imageCount === 2) {
      targetFolder = cache.themes[key];
      break;
    }
  }

  if (!targetFolder) {
    console.log("No folder with imageCount=2 found.");
    return;
  }

  console.log("Investigating folder:", targetFolder.name, targetFolder.id);

  // 1. Fetch all subfolders
  let currentParents = [targetFolder.id];
  const allSubFolders = [];
  while (currentParents.length > 0) {
    const parentQuery = currentParents.map(id => `'${id}' in parents`).join(' or ');
    const q = `trashed = false and (${parentQuery}) and mimeType = 'application/vnd.google-apps.folder'`;
    const res = await drive.files.list({ q, fields: 'files(id,name,parents)' });
    if (!res.data.files || res.data.files.length === 0) break;
    allSubFolders.push(...res.data.files);
    currentParents = res.data.files.map(f => f.id);
  }

  console.log("Subfolders found:", allSubFolders.map(f => f.name));

  const allValidFolderIds = [targetFolder.id, ...allSubFolders.map(f => f.id)];

  // 2. Fetch all images
  const parentQuery = allValidFolderIds.map(id => `'${id}' in parents`).join(' or ');
  const q = `trashed = false and (${parentQuery}) and (mimeType contains 'image/' or name contains '.jpg' or name contains '.png' or name contains '.webp' or name contains '.tif')`;
  const res = await drive.files.list({ q, fields: 'files(id,name,parents,mimeType)' });
  
  console.log("\nImages found:");
  for (const img of res.data.files) {
    console.log(`- ${img.name} (${img.mimeType}) [parents: ${img.parents}]`);
  }
}

run().catch(console.error);