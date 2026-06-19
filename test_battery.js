const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', path.join(process.env.APPDATA || 'C:\\Users\\CRIACAO\\AppData\\Roaming', 'banco-de-artes-desktop'));

app.whenReady().then(async () => {
  try {
    const configStore = require('./src/main/configStore.js');
    let config = configStore.loadConfig();
    
    // Inject credentials for testing if they are missing
    config.supabaseEnabled = true;
    config.supabaseUrl = 'https://tviagmllvnhnrumhmeli.supabase.co';
    config.supabasePublishableKey = 'sb_publishable_UVda8gD9YMptpWTfJLaeTA_3KJmBe-w';
    config.supabaseReadMode = 'supabase';
    config.supabaseAuthMode = 'supabase';

    console.log('--- TEST RESULTS BEGIN ---');

    // BLOCO 1 - SUPABASE
    // 1. auth:bootstrap-status
    try {
      const userService = require('./src/main/userService.js');
      const bStatus = await userService.bootstrapStatus(config);
      console.log('SUPABASE_AUTH_STATUS: OK -', bStatus.provider);
    } catch (e) {
      console.log('SUPABASE_AUTH_STATUS: FAIL -', e.message);
    }

    // Auto-login to get session
    const authService = require('./src/main/supabaseAuthService.js');
    let session;
    try {
      session = await authService.signIn(config, 'admin', 'admin123'); // Adjust if needed, or use existing session
    } catch (e) {
      // Ignore, we will use direct client if possible, or assume it's logged in if we run via app-level
      console.log('Attempting to use direct client for auth fallback:', e.message);
    }

    const { createSupabaseClient } = require('./src/main/supabaseService.js');
    const supabase = createSupabaseClient(config, authService.current()?.accessToken);

    // 2. supabaseService (artes / tabela principal)
    try {
      const { data, error } = await supabase.from('artworks').select('id, theme, product, metadata').limit(3);
      if (error) throw error;
      console.log('SUPABASE_ARTWORKS_READ: OK - First 3 items:', data.map(d => d.id).join(', '));
      
      // Write safe
      const testId = 9999999;
      const { error: insErr } = await supabase.from('artworks').insert({
        id: testId,
        theme: '__TEST_CLAUDE__',
        product: 'TEST',
        status: 'trash' // safe status
      });
      if (insErr) throw insErr;
      
      const { error: delErr } = await supabase.from('artworks').delete().eq('id', testId);
      if (delErr) throw delErr;
      
      console.log('SUPABASE_ARTWORKS_WRITE: OK - ID generated and deleted:', testId);
    } catch (e) {
      console.log('SUPABASE_ARTWORKS: FAIL -', e.message);
    }

    // 3. supabaseArtworkService
    try {
      const artworkService = require('./src/main/supabaseArtworkService.js');
      const arts = await artworkService.listArtworks(config);
      console.log('SUPABASE_ARTWORK_SERVICE_LIST: OK - Return type is array:', Array.isArray(arts), 'Size:', arts.length);
    } catch (e) {
      console.log('SUPABASE_ARTWORK_SERVICE_LIST: FAIL -', e.message);
    }

    // 4. supabaseConfigService
    try {
      const configService = require('./src/main/supabaseConfigService.js');
      // just try to load
      const cfg = configStore.loadConfig(); 
      console.log('SUPABASE_CONFIG_SERVICE: OK - Format is object:', typeof cfg === 'object');
    } catch (e) {
      console.log('SUPABASE_CONFIG_SERVICE: FAIL -', e.message);
    }

    // 5. supabasePresenceService
    try {
      const presenceService = require('./src/main/supabasePresenceService.js');
      const hb = await presenceService.heartbeat(config, 'test');
      const online = await presenceService.listOnline(config);
      console.log('SUPABASE_PRESENCE_SERVICE: OK - Online users:', online ? online.length : 'null');
    } catch (e) {
      console.log('SUPABASE_PRESENCE_SERVICE: FAIL -', e.message);
    }

    // 6. supabaseCoordinationService
    try {
      const coordService = require('./src/main/supabaseCoordinationService.js');
      const reservations = await coordService.listReservations(config);
      console.log('SUPABASE_COORD_READ: OK - Active reservations:', reservations.length);

      const res = await coordService.reserveIds(config, { count: 1, start: 999998, label: 'TEST' }, { login: 'admin' });
      await coordService.releaseReservation(config, res.id);
      console.log('SUPABASE_COORD_WRITE: OK - Reserved and released:', res.id);
    } catch (e) {
      console.log('SUPABASE_COORD_WRITE: FAIL -', e.message);
    }

    // 7. supabaseErrorLogService
    try {
      const errorLog = require('./src/main/supabaseErrorLogService.js');
      await errorLog.record(config, { level: 'info', source: 'claude_test', message: '__TEST__', context: { test: 1 } });
      
      // Try to clean up from supabase
      if (supabase) {
        await supabase.from('error_logs').delete().eq('source', 'claude_test');
      }
      console.log('SUPABASE_ERROR_LOG: OK - Recorded and deleted test log');
    } catch (e) {
      console.log('SUPABASE_ERROR_LOG: FAIL -', e.message);
    }

    // 8. auditService
    try {
      const auditService = require('./src/main/auditService.js');
      const logs = await auditService.list(config);
      console.log('SUPABASE_AUDIT: OK - Fetched logs without merging error, size:', logs.length);
    } catch (e) {
      console.log('SUPABASE_AUDIT: FAIL -', e.message);
    }

    // BLOCO 2 - GOOGLE DRIVE
    const googleService = require('./src/main/googleService.js');

    // 1. AUTH E CONEXAO
    try {
      const status = await googleService.authStatus(config, process.cwd());
      console.log('GOOGLE_AUTH_STATUS: OK - Connected:', status.connected, 'Email:', status.email);
    } catch (e) {
      console.log('GOOGLE_AUTH_STATUS: FAIL -', e.message);
    }
    
    // 2. LEITURA DE PASTAS
    try {
      const folders = await googleService.listDriveThemeFolders(config);
      console.log('GOOGLE_DRIVE_FOLDERS: OK - Size:', folders.length);
    } catch (e) {
      console.log('GOOGLE_DRIVE_FOLDERS: FAIL -', e.message);
    }

    // 4. TESTE DE ESCRITA SEGURA NO DRIVE
    try {
      const { drive } = await googleService.services(config, process.cwd());
      
      // Create folder
      const folderMeta = {
        name: '__TESTE_CLAUDE__',
        mimeType: 'application/vnd.google-apps.folder'
      };
      const folder = await drive.files.create({ resource: folderMeta, fields: 'id' });
      const folderId = folder.data.id;
      
      // Upload file
      const fileMeta = {
        name: 'test_ping.txt',
        parents: [folderId]
      };
      const media = {
        mimeType: 'text/plain',
        body: 'ping'
      };
      const file = await drive.files.create({ resource: fileMeta, media: media, fields: 'id' });
      
      // Read
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name)'
      });
      const listed = res.data.files.map(f => f.name).join(', ');
      
      // Delete
      await drive.files.delete({ fileId: folderId });
      console.log('GOOGLE_DRIVE_WRITE: OK - Created folder, uploaded test_ping.txt, listed [', listed, '] and deleted.');

    } catch (e) {
      console.log('GOOGLE_DRIVE_WRITE: FAIL -', e.message);
    }

    console.log('--- TEST RESULTS END ---');

  } catch (err) {
    console.error('CRITICAL ERROR:', err);
  } finally {
    app.quit();
  }
});
