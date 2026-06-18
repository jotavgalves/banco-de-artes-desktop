const fs = require("node:fs");
const path = require("node:path");
const configStore = require("../src/main/configStore");
const supabaseAuthService = require("../src/main/supabaseAuthService");
const supabaseArtworkService = require("../src/main/supabaseArtworkService");
const supabaseCoordinationService = require("../src/main/supabaseCoordinationService");

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../runtime/data/config.json"), "utf8"));
  
  // Set in configStore for any defaults or loaders
  configStore.setRuntimeConfig(config);

  console.log("Iniciando login no Supabase...");
  const auth = await supabaseAuthService.signIn(config, "joao", "121225");
  console.log(`Logado como ${auth.session.name} (${auth.session.role})`);

  console.log("Consultando proximo ID disponivel...");
  const ids1 = await supabaseArtworkService.nextAvailableArtworkIds(config, 1);
  const nextId = ids1[0];
  console.log("Proximo ID inicial:", nextId);

  console.log(`Reservando o ID ${nextId}...`);
  const host = require("node:os").hostname();
  const res = await supabaseCoordinationService.reserveIds(
    config, 
    { ids: [nextId], label: "Bateria de Testes Antigravity", note: "Teste automatico de pulo de ID" },
    { name: auth.session.name, computerName: host }
  );
  console.log("Reserva efetuada:", res);

  try {
    console.log("Consultando proximo ID disponivel com a reserva ativa...");
    const ids2 = await supabaseArtworkService.nextAvailableArtworkIds(config, 1);
    const nextIdAfterReservation = ids2[0];
    console.log("Proximo ID apos reserva:", nextIdAfterReservation);

    if (Number(nextIdAfterReservation) === Number(nextId)) {
      throw new Error(`FALHA: O ID reservado ${nextId} nao foi pulado!`);
    } else {
      console.log(`SUCESSO: O ID reservado ${nextId} foi pulado com sucesso! O proximo disponivel agora e ${nextIdAfterReservation}.`);
    }
  } finally {
    console.log(`Liberando a reserva temporaria do ID ${nextId}...`);
    await supabaseCoordinationService.releaseReservation(config, res.id);
    console.log("Reserva liberada.");
    supabaseAuthService.logout();
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Erro no teste:", err);
  process.exit(1);
});
