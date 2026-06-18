const { app } = require('electron');
app.whenReady().then(async () => {
  try {
    const store = require('./src/main/store.js');
    const photoshopService = require('./src/main/photoshopService.js');
    const config = store.loadConfig();
    const payload = {
      inputFolder: 'X:\\FESTAS E EVENTOS\\PAINEIS MARCKETPLACE\\SKUPR50 - PAINEIS REDONDOS 50 X 50\\SKUPR50 - IMPRESSÃO\\SKU - BABILONIA',
      product: 'bolinha',
      theme: 'BABILONIA',
      uploadAfter: true
    };
    console.log('--- STARTING BATCH TEST ---');
    await photoshopService.runPanel50Batch(config, app.getAppPath(), payload, { name: 'Codex Tester' }, (progress) => {
      console.log(`[PROGRESS] Phase: ${progress.phase} | ${progress.current}/${progress.total} | ${progress.detail}`);
    });
    console.log('--- DONE ---');
  } catch (err) {
    console.error('--- ERROR ---');
    console.error(err);
  } finally {
    app.quit();
  }
});