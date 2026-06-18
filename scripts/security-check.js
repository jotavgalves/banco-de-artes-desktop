const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

const projectRoot = path.resolve(__dirname, "..");
const electronBin = require("electron");
const port = Number(process.env.SECURITY_CHECK_CDP_PORT || 9343);

function getJson(route) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: route }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function waitForPage() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      const targets = await getJson("/json");
      const page = targets.find((target) => target.type === "page" && String(target.url || "").includes("index-premium.html"));
      if (page) return page;
    } catch {
      // Electron may still be booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("A janela do Electron não ficou disponível para o teste.");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    ws.on("open", () => {
      resolve({
        ws,
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const messageId = ++id;
            pending.set(messageId, { res, rej });
            ws.send(JSON.stringify({ id: messageId, method, params }));
          });
        },
      });
    });
    ws.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (!message.id || !pending.has(message.id)) return;
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callbacks.rej(new Error(message.error.message));
      else callbacks.res(message.result);
    });
    ws.on("error", reject);
  });
}

function expression(code) {
  return `Promise.race([(${code}), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))]).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error: error.message }))`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluate(client, name, code) {
  const result = await client.send("Runtime.evaluate", {
    expression: expression(code),
    awaitPromise: true,
    returnByValue: true,
  });
  const value = result.result.value;
  if (!value?.ok) throw new Error(`${name}: ${value?.error || "falhou"}`);
  return value.value;
}

async function main() {
  const fs = require("node:fs");
  const os = require("node:os");
  const desktopPath = path.join(os.homedir(), "Desktop", "autologin.txt");
  const tempPath = desktopPath + ".bak";
  let renamed = false;
  
  if (fs.existsSync(desktopPath)) {
    try {
      fs.renameSync(desktopPath, tempPath);
      renamed = true;
    } catch (e) {
      console.warn("Nao consegui ocultar autologin.txt temporariamente:", e.message);
    }
  }

  const child = spawn(electronBin, [`--remote-debugging-port=${port}`, "--disable-gpu", "--disable-http-cache", "."], {
    cwd: projectRoot,
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    const target = await waitForPage();
    const client = await connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const screen = await evaluate(client, "loginScreen", `({ loginHidden: document.getElementById("loginScreen")?.classList.contains("hidden"), appHidden: document.getElementById("appShell")?.classList.contains("hidden") })`);
    assert(screen.loginHidden === false && screen.appHidden === true, "O app não iniciou bloqueado na tela de login.");

    const publicConfig = await evaluate(client, "config:get", `window.artBank.getConfig()`);
    for (const key of ["credentialsPath", "supabasePublishableKey", "panel50OrganizedRoot", "financialClientRoot"]) {
      assert(!(key in publicConfig), `config:get vazou ${key} antes do login.`);
    }

    const protectedCalls = {
      listUsers: `window.artBank.listUsers()`,
      auditList: `window.artBank.auditList()`,
      dashboardData: `window.artBank.dashboardData()`,
      listArtworks: `window.artBank.listArtworks()`,
      runSync: `window.artBank.runSync()`,
      saveConfig: `window.artBank.saveConfig({ fixedDataFolder: "C:\\\\QA" })`,
      createReservation: `window.artBank.createReservation({ start: 1, count: 1, label: "QA" })`,
    };

    for (const [name, code] of Object.entries(protectedCalls)) {
      const outcome = await evaluate(client, name, `${code}.then(() => ({ allowed: true }), (error) => ({ allowed: false, error: error.message }))`);
      assert(outcome.allowed === false && /Login necessário|Ação restrita ao admin/.test(outcome.error || ""), `${name} ficou acessível antes do login.`);
    }

    client.ws.close();
    console.log("Security check OK");
  } finally {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 1000);
    if (renamed && fs.existsSync(tempPath)) {
      try {
        fs.renameSync(tempPath, desktopPath);
      } catch (e) {
        console.error("ERRO CRITICO: Nao consegui restaurar autologin.txt:", e.message);
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
