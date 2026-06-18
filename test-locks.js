const fs = require('fs');
const path = require('path');

const { app } = require('electron');

app.setPath('userData', 'C:\\Users\\CRIACAO\\AppData\\Roaming\\banco-de-artes-desktop');
async function testLocks() {
  await app.whenReady();
  const { loadConfig } = require('./src/main/configStore.js');
  const config = loadConfig();
  const supabaseService = require('./src/main/supabaseCoordinationService.js');
  
  console.log("1. Checking lock status...");
  let status = await supabaseService.lockStatus(config);
  console.log("Status:", JSON.stringify(status, null, 2));

  console.log("\n2. Acquiring lock...");
  let lock = null;
  try {
    lock = await supabaseService.acquireOperationLock(config, "TESTE_AUTOMATIZADO", 5);
    console.log("Lock acquired:", lock);
  } catch(e) {
    console.log("Failed to acquire lock:", e.message);
  }

  console.log("\n3. Checking lock status again...");
  status = await supabaseService.lockStatus(config);
  console.log("Status:", JSON.stringify(status, null, 2));

  if (lock && lock.id) {
    console.log("\n4. Releasing lock...");
    await supabaseService.releaseOperationLock(config, lock.id);
    console.log("Lock released.");
    
    status = await supabaseService.lockStatus(config);
    console.log("Status after release:", JSON.stringify(status, null, 2));
  }

  console.log("\n=====================\n");
  console.log("5. Testing Reservations...");
  
  console.log("Listing current reservations:");
  let reservations = await supabaseService.listReservations(config);
  console.log(reservations);

  console.log("\nCreating a test reservation for ID 99999...");
  let res = null;
  try {
    res = await supabaseService.reserveIds(config, { ids: [99999], label: "Test Node.js", note: "Testing from backend" }, { name: "Antigravity", computerName: "TestEnv" });
    console.log("Reservation created:", res);
  } catch(e) {
    console.log("Failed to create reservation:", e.message);
  }

  console.log("\nListing reservations again...");
  reservations = await supabaseService.listReservations(config);
  console.log(reservations);

  if (res && res.id) {
    console.log("\nReleasing reservation...");
    await supabaseService.releaseReservation(config, res.id);
    console.log("Released.");
    
    reservations = await supabaseService.listReservations(config);
    console.log("Final list:", reservations);
  }
}

testLocks().catch(console.error);