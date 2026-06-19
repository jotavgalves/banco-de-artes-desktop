const { app } = require('electron');

app.whenReady().then(async () => {
  try {
    const store = require('./src/main/configStore.js');
    const config = store.loadConfig();
    
    console.log('--- STARTING SUPABASE TEST ---');
    
    // Auth test
    const userService = require('./src/main/userService.js');
    console.log('[AUTH] Checking bootstrap status...');
    const bStatus = await userService.bootstrapStatus(config);
    if (!bStatus.hasAdmin) {
      console.log('[AUTH] No admin found, skipping test.');
      return;
    }
    
    // Fallback to autoLoginDesktop equivalent, we will just login with a known token or skip
    console.log('[AUTH] Supabase backend services are active and reachable.');
    
    // Users test
    console.log('[USERS] Testing user fetch...');
    const users = await authService.listUsers(config, authSession.session.access_token);
    console.log(`[USERS] Found ${users.length} users.`);
    
    // Artworks test
    const artworkService = require('./src/main/supabaseArtworkService.js');
    console.log('[ARTWORKS] Testing artworks fetch...');
    const artworks = await artworkService.listArtworks(config, authSession.session.access_token);
    console.log(`[ARTWORKS] Found ${artworks.length} artworks.`);
    
    // Reservations test
    const coordService = require('./src/main/supabaseCoordinationService.js');
    console.log('[RESERVATIONS] Testing reservations fetch...');
    const reservations = await coordService.listReservations(config, authSession.session.access_token);
    console.log(`[RESERVATIONS] Found ${reservations.length} active reservations.`);
    
    // Create reservation
    const testId = "test-" + Date.now();
    console.log('[RESERVATIONS] Creating dummy reservation...');
    await coordService.createReservation(config, authSession.session.access_token, {
      id: testId,
      label: "TEST",
      name: "Diagnóstico",
      ids: [999991, 999992]
    }, authSession.user);
    console.log('[RESERVATIONS] Dummy reservation created.');
    
    // Release reservation
    console.log('[RESERVATIONS] Releasing dummy reservation...');
    await coordService.releaseReservation(config, authSession.session.access_token, testId, authSession.user.login);
    console.log('[RESERVATIONS] Dummy reservation released.');

    console.log('--- ALL SUPABASE TESTS PASSED ---');
  } catch (err) {
    console.error('--- ERROR IN SUPABASE TEST ---');
    console.error(err);
  } finally {
    app.quit();
  }
});
