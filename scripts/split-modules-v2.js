/**
 * split-modules-v2.js
 * Extracts ALL top-level functions from app-premium.js using brace counting,
 * then assigns each to the correct module file.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app-premium.js'), 'utf-8');
const LINES = SRC.split(/\r?\n/);

// ---- Step 1: Extract every top-level declaration ----

function extractAllFunctions() {
  const funcs = [];
  const funcStartRe = /^(async\s+)?function\s+(\w+)\s*\(/;
  
  for (let i = 0; i < LINES.length; i++) {
    const trimmed = LINES[i].trim();
    const m = trimmed.match(funcStartRe);
    if (!m) continue;
    
    const name = m[2];
    const startIdx = i;
    
    // Count braces to find end
    let depth = 0;
    let endIdx = i;
    let foundOpen = false;
    for (let j = i; j < LINES.length; j++) {
      for (const ch of LINES[j]) {
        if (ch === '{') { depth++; foundOpen = true; }
        if (ch === '}') { depth--; }
      }
      if (foundOpen && depth === 0) {
        endIdx = j;
        break;
      }
    }
    
    funcs.push({
      name,
      startLine: startIdx + 1, // 1-indexed
      endLine: endIdx + 1,
      code: LINES.slice(startIdx, endIdx + 1).join('\n')
    });
    
    // Skip past this function
    i = endIdx;
  }
  return funcs;
}

const allFuncs = extractAllFunctions();
console.log(`Found ${allFuncs.length} top-level functions.`);

// ---- Step 2: Assign functions to modules ----

const moduleAssignments = {
  // UTILS
  utils: [
    'setBusy', 'clearBusy', 'startActionProgress', 'updateActionProgress', 'finishActionProgress',
    'toast', 'confirmAction', 'resolveConfirm', 'escapeHtml', 'friendlyError'
  ],
  
  // AUTH
  auth: [
    'loadBootstrap', 'renderLoginMode', 'handleLogin', 'logout',
    'startHeartbeat', 'currentViewName', 'recoverAdminAccess', 'refreshPresence',
    'renderListSkeleton'
  ],
  
  // BOOT
  boot: [
    'boot', 'bindNavigation', 'bindActions', 'bindFilters',
    'installErrorLogging', 'reportClientError', 'showView', 'refreshAll'
  ],
  
  // CONFIG
  config: [
    'loadConfig', 'renderExternalLinks', 'fillSettingsForm', 'readSettingsForm',
    'saveSettings', 'testConnectivity', 'refreshSupabaseStatus', 'renderConfig',
    'refreshAuthStatus', 'authenticateGoogle', 'provisionGoogle', 'submitAuthCode',
    'relinkGoogle', 'renderUsage', 'renderProvisioningPlan',
    'lines', 'formatProductSizes', 'parseProductSizes', 'applyProductSizeRule',
  ],
  
  // USERS
  users: [
    'refreshUsers', 'renderUsers', 'renderUserCards', 'fillUserEditForm', 'saveUser',
    'toggleUserActive', 'deleteSelectedUser', 'setUsersTab',
    'handleUserActionSubmit', 'toggleSelectedUserActive', 'refreshLocks',
    'refreshAudit',
  ],
  
  // ARTWORKS
  artworks: [
    'refreshArtworks', 'renderArtworkTable', 'renderArtworkCards', 'artThumb', 'imagePreviewUrl',
    'handleArtworksAction', 'toggleArtSelection', 'syncArtworkBulkControls',
    'toggleAllVisibleArtworks', 'syncArtworkViewMode', 'currentArtworkViewMode',
    'toggleArtworkTools', 'downloadArts',
    'refreshDashboardData', 'renderDashboardCards', 'nextAvailableDashboardId',
    'openReservationModal', 'updateReservationCount', 'createReservation', 'refreshReservations',
    'updateReservationStatus',
    'removeSelectedRows', 'openFindArtworkModal', 'closeFindArtworkModal',
    'openArtworkLocation', 'showPreviewFallback', 'closePreview',
    'refreshMissingArtworkImages', 'saveAllArtworkEdits', 'deleteSelectedArtworks',
    'renderUploadProgress', 'populateArtworkFilters', 'renderFilteredArtworks',
    'isArtworkCatalogVisible', 'renderArtworkSkeleton', 'markArtworkImageBroken',
    'markArtworkImageLoaded', 'artCell', 'artEditInput', 'artActions',
    'saveArtworkEdit', 'deleteArtwork', 'refreshArtworkUrl', 'artworkNeedsImageRefresh',
    'openLocalPreview', 'openDrivePreview', 'hidePreviewFallback',
    'rangeLabel', 'driveFileId', 'fieldHasError',
    'timeUntil', 'formatDuration',
  ],
  
  // DRIVE
  drive: [
    'refreshDriveFolders', 'renderDriveFolders', 'openDriveRoot', 'scanConfiguredFolders',
  ],
  
  // BATCH
  batch: [
    'runValidation', 'runUpload', 'loadMockup', 'renderRows',
    'validateRowLocal', 'validateRows', 'uploadBatch',
    'formatBytes', 'formatTime', 'checkBrokenImages',
    'populateBatchProductFilter', 'setMode', 'fillFromReservation',
    'runPanel50Automation', 'choosePanel50Input', 'choosePanel50Mockup',
    'updatePanel50ThemePreview', 'renderPanel50Progress',
    'fillPanel50AutomationForm', 'detectPanel50Theme',
    'parseStandardRows', 'batchThumbCell', 'localFileUrl', 'bindBatchInputs',
    'cell', 'productCell', 'sizeCell', 'status', 'uploadOne', 'doUpload',
    'clearBatch', 'renderSummary', 'setBatchActionStatus',
    'selectedBatchFolders', 'usableBatchPath',
  ],
  
  // FINANCE
  finance: [
    'refreshFinanceData', 'refreshFinanceClients', 'refreshFinancePreview',
    'renderFinanceCards', 'renderFinancePreview', 'renderFinancePreviewSkeleton',
    'openOrderModal', 'closeOrderModal', 'clearFinanceOrder',
    'addOrderItem', 'handleFinanceCodeKey', 'handleFinanceClientInput',
    'updateFinanceSummary', 'copyFinanceOrder', 'generateOrderPreview',
    'copyOrderCode', 'confirmFinanceOrder', 'saveOrder',
    'renderClientSuggestions', 'selectedFinanceIds', 'updateFinanceSelectedCount',
    'removeFinanceItem', 'changeFinanceItemQuantity',
  ],
};

// Build a quick lookup: funcName -> moduleName
const funcToModule = {};
for (const [mod, names] of Object.entries(moduleAssignments)) {
  for (const name of names) funcToModule[name] = mod;
}

// Group functions by module
const moduleContents = {};
for (const key of Object.keys(moduleAssignments)) moduleContents[key] = [];

const unassigned = [];

for (const func of allFuncs) {
  const mod = funcToModule[func.name];
  if (mod) {
    moduleContents[mod].push(func.code);
  } else {
    unassigned.push(func.name);
  }
}

if (unassigned.length) {
  console.log('Unassigned functions:', unassigned.join(', '));
}

// ---- Step 3: Extract non-function code ----

// Lines 1-28: state declaration
const stateCode = LINES.slice(0, 28).join('\n');

// Lines 30-32: selector helpers
const selectorsCode = LINES.slice(29, 32).join('\n');

// Line 2519: boot() call — not needed in modules, will go in HTML inline script

// ---- Step 4: Write files ----
const rendererDir = path.join(__dirname, '..', 'src', 'renderer');

// State
fs.writeFileSync(path.join(rendererDir, 'core', 'state.js'), stateCode + '\n');

// Utils = selectors + util functions
fs.writeFileSync(path.join(rendererDir, 'core', 'utils.js'), selectorsCode + '\n\n' + moduleContents.utils.join('\n\n') + '\n');

// Boot
fs.writeFileSync(path.join(rendererDir, 'core', 'boot.js'), moduleContents.boot.join('\n\n') + '\n');

// Modules
for (const mod of ['auth', 'config', 'users', 'artworks', 'drive', 'batch', 'finance']) {
  fs.writeFileSync(
    path.join(rendererDir, 'modules', `${mod}.js`),
    moduleContents[mod].join('\n\n') + '\n'
  );
}

console.log('\n--- Files written ---');

// ---- Step 5: Syntax check all files ----
const { execSync } = require('child_process');
const files = [
  'core/state.js', 'core/utils.js', 'core/boot.js',
  'modules/auth.js', 'modules/config.js', 'modules/users.js',
  'modules/artworks.js', 'modules/drive.js', 'modules/batch.js', 'modules/finance.js'
];

let allGood = true;
for (const f of files) {
  const fullPath = path.join(rendererDir, f);
  const lineCount = fs.readFileSync(fullPath, 'utf-8').split('\n').length;
  try {
    execSync(`node -c "${fullPath}"`, { stdio: 'pipe' });
    console.log(`  OK  ${f} (${lineCount} lines)`);
  } catch (e) {
    const errMsg = e.stderr?.toString().split('\n').slice(0, 3).join(' | ');
    console.error(`  FAIL ${f} (${lineCount} lines): ${errMsg}`);
    allGood = false;
  }
}

// ---- Step 6: Verify all functions accounted for ----
const allExtracted = Object.values(moduleContents).flat().join('\n');
const missing = allFuncs.filter(f => !allExtracted.includes(`function ${f.name}`)).map(f => f.name);

if (missing.length) {
  console.log('\nMISSING from modules:', missing.join(', '));
} else {
  console.log('\nAll', allFuncs.length, 'functions accounted for!');
}

if (allGood) {
  console.log('\n✅ ALL MODULES PASS SYNTAX CHECK');
} else {
  console.log('\n❌ SOME MODULES HAVE SYNTAX ERRORS');
}
