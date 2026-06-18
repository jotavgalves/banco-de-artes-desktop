/**
 * split-modules.js
 * Splits app-premium.js into modules using brace-counting to find real function boundaries.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app-premium.js'), 'utf-8');
const LINES = SRC.split(/\r?\n/);

// Find a top-level function by name, tracking braces to get the complete body
function extractFunction(name) {
  // Match: function name(  or  async function name(
  const startRe = new RegExp(`^(async\\s+)?function\\s+${name}\\s*\\(`);
  let startIdx = -1;
  for (let i = 0; i < LINES.length; i++) {
    if (startRe.test(LINES[i].trim())) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    console.warn(`  WARNING: function "${name}" not found`);
    return null;
  }
  
  // Now count braces from startIdx until depth returns to 0
  let depth = 0;
  let endIdx = startIdx;
  let foundOpen = false;
  for (let i = startIdx; i < LINES.length; i++) {
    const line = LINES[i];
    // Simple brace counting (ignoring strings/comments for this codebase which is clean)
    for (const ch of line) {
      if (ch === '{') { depth++; foundOpen = true; }
      if (ch === '}') { depth--; }
    }
    if (foundOpen && depth === 0) {
      endIdx = i;
      break;
    }
  }
  
  return LINES.slice(startIdx, endIdx + 1).join('\n');
}

// Extract a range of lines (1-indexed, inclusive)
function extractRange(start, end) {
  return LINES.slice(start - 1, end).join('\n');
}

// Build module content from function names
function buildModule(funcNames) {
  const parts = [];
  for (const name of funcNames) {
    const code = extractFunction(name);
    if (code) parts.push(code);
  }
  return parts.join('\n\n');
}

// ---- Define modules ----

// 1. STATE: lines 1–28
const stateCode = extractRange(1, 28);

// 2. UTILS: lines 30–32 (selectors) + functions
const selectorsCode = extractRange(30, 32);
const utilFuncs = buildModule([
  'setBusy', 'clearBusy', 'startActionProgress', 'updateActionProgress', 'finishActionProgress',
  'toast', 'confirmAction', 'resolveConfirm', 'escapeHtml', 'friendlyError'
]);
const utilsCode = selectorsCode + '\n\n' + utilFuncs;

// 3. AUTH: login, logout, heartbeat, presence, bootstrap
const authFuncs = buildModule([
  'loadBootstrap', 'renderLoginMode', 'handleLogin', 'logout',
  'startHeartbeat', 'currentViewName', 'recoverAdminAccess', 'refreshPresence'
]);

// 4. BOOT: boot, navigation, actions, filters, error logging, views, refreshAll
const bootFuncs = buildModule([
  'boot', 'bindNavigation', 'bindActions', 'bindFilters',
  'installErrorLogging', 'reportClientError', 'showView', 'refreshAll'
]);

// 5. CONFIG: settings, google auth, supabase
const configFuncs = buildModule([
  'loadConfig', 'renderExternalLinks', 'fillSettingsForm', 'readSettingsForm',
  'saveSettings', 'testConnectivity', 'refreshSupabaseStatus', 'renderConfig',
  'refreshAuthStatus', 'authenticateGoogle', 'provisionGoogle', 'submitAuthCode',
  'relinkGoogle', 'renderUsage'
]);

// 6. USERS
const usersFuncs = buildModule([
  'refreshUsers', 'renderUsers', 'fillUserEditForm', 'saveUser',
  'toggleUserActive', 'deleteSelectedUser', 'setUsersTab',
  'handleUserActionSubmit', 'toggleSelectedUserActive'
]);

// 7. ARTWORKS + DASHBOARD + RESERVATIONS
const artworkFuncs = buildModule([
  'refreshArtworks', 'renderArtworkTable', 'renderArtworkCards', 'artThumb', 'imagePreviewUrl',
  'handleArtworksAction', 'toggleArtSelection', 'syncArtworkBulkControls',
  'toggleAllVisibleArtworks', 'syncArtworkViewMode', 'currentArtworkViewMode',
  'toggleArtworkTools', 'downloadArts',
  'refreshDashboardData', 'renderDashboardCards',
  'openReservationModal', 'updateReservationCount', 'createReservation', 'refreshReservations',
  'removeSelectedRows', 'openFindArtworkModal', 'closeFindArtworkModal',
  'openArtworkLocation', 'showPreviewFallback', 'closePreview',
  'refreshMissingArtworkImages', 'saveAllArtworkEdits', 'deleteSelectedArtworks',
  'renderUploadProgress'
]);

// 8. DRIVE
const driveFuncs = buildModule([
  'refreshDriveFolders', 'renderDriveFolders', 'openDriveRoot'
]);

// 9. BATCH
const batchFuncs = buildModule([
  'runValidation', 'runUpload', 'loadMockup', 'renderRows',
  'validateRowLocal', 'validateRows', 'uploadBatch',
  'formatBytes', 'formatTime', 'checkBrokenImages',
  'populateBatchProductFilter', 'setMode', 'fillFromReservation',
  'runPanel50Automation', 'choosePanel50Input', 'updatePanel50ThemePreview',
  'renderPanel50Progress'
]);

// 10. FINANCE
const financeFuncs = buildModule([
  'refreshFinanceData', 'refreshFinanceClients', 'refreshFinancePreview',
  'renderFinanceCards', 'renderFinancePreview',
  'openOrderModal', 'closeOrderModal', 'clearFinanceOrder',
  'addOrderItem', 'handleFinanceCodeKey', 'handleFinanceClientInput',
  'updateFinanceSummary', 'copyFinanceOrder', 'generateOrderPreview',
  'copyOrderCode', 'confirmFinanceOrder', 'saveOrder'
]);

// ---- Write files ----
const rendererDir = path.join(__dirname, '..', 'src', 'renderer');

fs.writeFileSync(path.join(rendererDir, 'core', 'state.js'), stateCode + '\n');
fs.writeFileSync(path.join(rendererDir, 'core', 'utils.js'), utilsCode + '\n');
fs.writeFileSync(path.join(rendererDir, 'core', 'boot.js'), bootFuncs + '\n');
fs.writeFileSync(path.join(rendererDir, 'modules', 'auth.js'), authFuncs + '\n');
fs.writeFileSync(path.join(rendererDir, 'modules', 'config.js'), configFuncs + '\n');
fs.writeFileSync(path.join(rendererDir, 'modules', 'users.js'), usersFuncs + '\n');
fs.writeFileSync(path.join(rendererDir, 'modules', 'artworks.js'), artworkFuncs + '\n');
fs.writeFileSync(path.join(rendererDir, 'modules', 'drive.js'), driveFuncs + '\n');
fs.writeFileSync(path.join(rendererDir, 'modules', 'batch.js'), batchFuncs + '\n');
fs.writeFileSync(path.join(rendererDir, 'modules', 'finance.js'), financeFuncs + '\n');

console.log('--- Module extraction complete ---');

// Verify syntax of each file
const files = [
  'core/state.js', 'core/utils.js', 'core/boot.js',
  'modules/auth.js', 'modules/config.js', 'modules/users.js',
  'modules/artworks.js', 'modules/drive.js', 'modules/batch.js', 'modules/finance.js'
];

const { execSync } = require('child_process');
let allGood = true;
for (const f of files) {
  const fullPath = path.join(rendererDir, f);
  try {
    execSync(`node -c "${fullPath}"`, { stdio: 'pipe' });
    console.log(`  OK  ${f}`);
  } catch (e) {
    console.error(`  FAIL ${f}: ${e.stderr?.toString().trim()}`);
    allGood = false;
  }
}

if (allGood) {
  console.log('\nAll modules have valid syntax!');
} else {
  console.log('\nSome modules have syntax errors - need to fix before proceeding.');
}

// Also check: which functions from the original were NOT extracted?
const allFuncNames = [];
const funcRe = /^(?:async\s+)?function\s+(\w+)\s*\(/;
for (const line of LINES) {
  const m = line.trim().match(funcRe);
  if (m) allFuncNames.push(m[1]);
}

const extractedContent = [
  stateCode, utilsCode, bootFuncs, authFuncs, configFuncs,
  usersFuncs, artworkFuncs, driveFuncs, batchFuncs, financeFuncs
].join('\n');

const missing = allFuncNames.filter(name => {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  return !re.test(extractedContent);
});

if (missing.length) {
  console.log('\nFunctions NOT yet in any module:', missing.join(', '));
} else {
  console.log('\nAll functions accounted for!');
}
