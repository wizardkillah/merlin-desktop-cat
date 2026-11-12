// Proceso principal de Electron: ventana flotante del gatito, IA, voz y herramientas.
const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Menu, Tray, nativeImage, session, protocol, net, utilityProcess, safeStorage, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");
const { makeTools } = require("./tools");
const brain = require("./brain");
const claude = require("./claude");
const docs = require("./documentos");
const oidoNativo = require("./oido-nativo");
const personalidad = require("./personalidad");
const memoria = require("./memoria");
const respuestas = require("./respuestas");
const aprendizaje = require("./aprendizaje");
const recordatorios = require("./recordatorios");

// Modo prueba: electron . --test-whisper=ruta.wav  (transcribe y sale)
const TEST_WAV = (process.argv.find((a) => a.startsWith("--test-whisper=")) || "").split("=").slice(1).join("=");

// Modo prueba: electron . --prueba-voz=carpeta [--prueba-voz-modo=medir]  (habla por el altavoz, guarda lo que suena y sale)
const argumento = (nombre) => (process.argv.find((a) => a.startsWith(`--${nombre}=`)) || "").split("=").slice(1).join("=");
const PRUEBA_VOZ = argumento("prueba-voz");

// Ya hay un Merlín abierto: se sale en el acto, antes de abrir la base de datos o registrar nada (la otra instancia se muestra sola)
if (!TEST_WAV && !PRUEBA_VOZ && !app.requestSingleInstanceLock()) { app.exit(0); return; }

// Protocolo app:// con aislamiento de origen -> WebAssembly multihilo para Whisper
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const ROOT = path.join(__dirname, "..");
const SERVED = ["src/renderer/", "Imagenes Merlin/", "assets/voces/", "node_modules/@huggingface/transformers/dist/", "node_modules/onnxruntime-web/dist/", "node_modules/@diffusionstudio/piper-wasm/build/"];
// Merlín responde aunque se le llame con un atajo de teclado, sin un clic previo en la ventana
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
function serveApp() {
  protocol.handle("app", async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
    let file;
    if (rel === "__test.wav" && TEST_WAV) file = path.resolve(TEST_WAV);
    else if (SERVED.some((p) => rel.startsWith(p)) && !rel.includes("..")) file = path.join(ROOT, rel);
    if (!file || !fs.existsSync(file)) return new Response("no encontrado", { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    const ext = path.extname(file);
    headers.set("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".wav": "audio/wav", ".json": "application/json", ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg" }[ext] || "application/octet-stream");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(res.body, { status: 200, headers });
  });
}

const W = 360, H = 500;
const SETTINGS_FILE = path.join(app.getPath("userData"), "ajustes.json");
const PERFILES_VOZ = [["merlin", "Merlín"], ["gato", "Gato travieso"], ["hechicero", "Hechicero"], ["natural", "Natural"]];
// Un ajustes.json dañado no debe impedir que arranque: se aparta y se usan los valores por defecto
function leerAjustes() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  try {
    const datos = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    if (datos && typeof datos === "object" && !Array.isArray(datos)) return datos;
  } catch {}
  console.log("[ajustes] ajustes.json estaba dañado: lo guardo como ajustes.dañado.json y uso los valores por defecto");
  try { fs.renameSync(SETTINGS_FILE, SETTINGS_FILE.replace(/\.json$/, ".dañado.json")); } catch {}
  return {};
}
const settings = { voz: true, paseos: true, perfilVoz: "merlin", usarClaude: true, docsEnClaude: false, escuchaContinua: true, modeloClaude: "claude-opus-5-5", limiteMensual: 5, ...leerAjustes() };
// Escribir en un temporal y renombrar: un apagón a media escritura deja el archivo anterior entero
const saveSettings = () => {
  try { fs.writeFileSync(SETTINGS_FILE + ".tmp", JSON.stringify(settings, null, 2)); fs.renameSync(SETTINGS_FILE + ".tmp", SETTINGS_FILE); }
  catch (e) { console.log("[ajustes] no pude guardar:", e.message); }
};

// Clave de Claude: cifrada con la cuenta de Windows, nunca en ajustes.json. La variable ANTHROPIC_API_KEY también sirve.
const CLAVE_FILE = path.join(app.getPath("userData"), "claude.clave");
function cargarClave() {
  try { if (fs.existsSync(CLAVE_FILE)) claude.configurar(safeStorage.decryptString(fs.readFileSync(CLAVE_FILE))); }
  catch (e) { console.log("[claude] no pude leer la clave guardada:", e.message); }
}
claude.usarModelo(process.env.CLAUDE_MODEL || settings.modeloClaude);
// Pasado el tope del mes, Claude descansa hasta el mes siguiente y responde el cerebro local
const sobreTope = () => settings.limiteMensual > 0 && aprendizaje.gastoMes() >= settings.limiteMensual;
const claudeActivo = () => settings.usarClaude && claude.disponible() && !sobreTope();

let win, tray, walkTimer, currentAbort, indexer;
const history = [];
const citasAbribles = new Set(); // solo se pueden abrir desde el bocadillo las rutas que se han citado
const DOCS_DB = path.join(app.getPath("userData"), "documentos.db");
const docsDb = docs.abrirBD(DOCS_DB);
const tools = makeTools({ openExternal: (u) => shell.openExternal(u), openPath: (p) => shell.openPath(p), docsDb });
const send = (ch, ...a) => win && !win.isDestroyed() && win.webContents.send(ch, ...a);

// El índice de documentos se mantiene en un proceso aparte de baja prioridad
let progresoIndice = null;
function arrancarIndexador() {
  indexer = utilityProcess.fork(path.join(__dirname, "indexer.js"), [DOCS_DB], { serviceName: "Índice de documentos de Merlín", stdio: "ignore" });
  indexer.on("message", (m) => {
    if (m.tipo === "progreso") progresoIndice = m;
    if (m.tipo === "fin" || m.tipo === "error") { progresoIndice = null; console.log("[indice]", JSON.stringify(m)); }
  });
  indexer.on("exit", (c) => { if (c) console.log("[indice] terminó con código", c); indexer = null; });
}
function textoEstadoIndice() {
  const e = docs.estadoIndice(docsDb);
  if (progresoIndice) return `📚 Leyendo documentos: ${progresoIndice.hechos} de ${progresoIndice.total}`;
  return e.pendientes ? `📚 ${e.indexados} documentos leídos, faltan ${e.pendientes}` : `📚 ${e.indexados} documentos leídos`;
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: W, height: H,
    x: wa.x + wa.width - W - 20, y: wa.y + wa.height - H,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadURL("app://local/src/renderer/index.html" + (TEST_WAV ? "?test=1" : PRUEBA_VOZ ? `?pruebavoz=${encodeURIComponent(argumento("prueba-voz-modo") || "programa")}` : ""));

  // Los ojos siguen al ratón por todo el escritorio
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const c = screen.getCursorScreenPoint(), b = win.getBounds();
    send("cursor", { x: c.x - b.x, y: c.y - b.y });
  }, 80);
}

// ---------- Menú (clic derecho en el gatito y bandeja) ----------
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: `🎤 Hablar  (Ctrl+Shift+Espacio)`, click: () => send("toggle-listen") },
    { label: `⌨️ Escribir  (Ctrl+Shift+K)`, click: () => send("open-input") },
    { type: "separator" },
    { label: "Escuchar siempre (di «Merlín»)", type: "checkbox", checked: settings.escuchaContinua, click: (i) => { settings.escuchaContinua = i.checked; saveSettings(); send("settings", settings); } },
    { label: "Cerebro", submenu: [
      { label: "Usar Claude", type: "checkbox", checked: settings.usarClaude, enabled: claude.disponible(), click: (i) => { settings.usarClaude = i.checked; saveSettings(); if (!claudeActivo()) prepararModelo(); } },
      { label: "Modelo de Claude", submenu: Object.entries(claude.MODELOS).map(([id, m]) => ({ label: m.nombre, type: "radio", checked: claude.modelo() === id, click: () => { settings.modeloClaude = id; claude.usarModelo(id); saveSettings(); } })) },
      { label: `Gasto de este mes: ${aprendizaje.gastoMes().toFixed(2)} US$`, enabled: false },
      { label: "Tope de gasto mensual", submenu: [1, 5, 10, 20, 0].map((v) => ({ label: v ? `${v} US$` : "Sin tope", type: "radio", checked: settings.limiteMensual === v, click: () => { settings.limiteMensual = v; saveSettings(); } })) },
      { label: "Enviar fragmentos de mis documentos a Claude", type: "checkbox", checked: settings.docsEnClaude, click: (i) => { settings.docsEnClaude = i.checked; saveSettings(); } },
      { type: "separator" },
      { label: claude.disponible() ? "Cambiar la clave de Claude..." : "Poner la clave de Claude...", click: () => send("pedir-clave") },
      { label: "Quitar la clave de Claude", enabled: fs.existsSync(CLAVE_FILE), click: () => { fs.rmSync(CLAVE_FILE, { force: true }); claude.configurar(""); prepararModelo(); send("say", "Listo, ya no uso Claude."); } },
    ] },
    { label: "Leer respuestas en voz alta", type: "checkbox", checked: settings.voz, click: (i) => { settings.voz = i.checked; saveSettings(); send("settings", settings); } },
    { label: "Personalidad", submenu: [
      { label: "Editar sus rasgos", click: () => { personalidad.asegurar(); shell.openPath(personalidad.rutaRasgos()); } },
      { label: "Ver lo que sabe de mí", click: () => { personalidad.asegurar(); shell.openPath(personalidad.rutaAprendizaje()); } },
      { label: "Abrir su memoria por temas", click: () => { memoria.asegurar(); shell.openPath(memoria.rutaCarpeta()); } },
      { label: "Editar su lista de respuestas", click: () => { respuestas.asegurar(); shell.openPath(respuestas.ruta()); } },
      { label: "Ver qué le falta por aprender", click: () => { aprendizaje.escribirInforme(); shell.openPath(aprendizaje.rutaInforme()); } },
    ] },
    { label: "Tono de voz", submenu: PERFILES_VOZ.map(([id, label]) => ({ label, type: "radio", checked: settings.perfilVoz === id, click: () => { settings.perfilVoz = id; saveSettings(); send("settings", settings); } })) },
    { label: "Pasear por el escritorio", type: "checkbox", checked: settings.paseos, click: (i) => { settings.paseos = i.checked; saveSettings(); send("settings", settings); } },
    { label: "Olvidar la conversación", click: () => { history.length = 0; delete history.ultimoDocumento; send("say", "Listo, ya lo olvidé todo. ✨"); } },
    { label: "Volver a la esquina", click: () => { const wa = screen.getPrimaryDisplay().workArea; win.setPosition(wa.x + wa.width - W - 20, wa.y + wa.height - H); } },
    { type: "separator" },
    { label: textoEstadoIndice(), enabled: false },
    { label: "Releer mis documentos ahora", click: () => { if (indexer) indexer.postMessage("reindexar"); else arrancarIndexador(); } },
    { type: "separator" },
    { label: "Salir", click: () => app.quit() },
  ]);
}

// ---------- IPC ----------
ipcMain.handle("get-settings", () => ({ ...settings, name: brain.ASSISTANT_NAME }));
ipcMain.on("set-ignore", (_e, ignore) => win.setIgnoreMouseEvents(ignore, { forward: true }));
ipcMain.on("focus", () => { win.setIgnoreMouseEvents(false); win.focus(); });
ipcMain.on("context-menu", () => buildMenu().popup({ window: win }));
ipcMain.on("drag", (_e, { dx, dy }) => { const [x, y] = win.getPosition(); win.setPosition(Math.round(x + dx), Math.round(y + dy)); });
ipcMain.on("tray-icon", (_e, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  if (tray) return tray.setImage(img);
  tray = new Tray(img);
  tray.setToolTip(`${brain.ASSISTANT_NAME} — tu gatito brujo`);
  tray.on("click", () => { win.show(); send("open-input"); });
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu())); // se reconstruye para mostrar el estado actual del índice
});

// Paseo: mueve la ventana horizontalmente con animación. Si se interrumpe, la promesa se resuelve igual con lo
// recorrido: si quedara pendiente, el bucle de paseos del renderer se quedaría esperando y no volvería a pasear.
let terminarPaseo = () => {};
ipcMain.handle("walk", (_e, dist) => new Promise((resolve) => {
  terminarPaseo();
  const disp = screen.getDisplayMatching(win.getBounds()).workArea;
  const [x0, y] = win.getPosition();
  const target = Math.max(disp.x - 85, Math.min(disp.x + disp.width - W + 85, x0 + dist));
  const steps = Math.max(1, Math.round(Math.abs(target - x0) / 2.2));
  let i = 0;
  terminarPaseo = () => {
    clearInterval(walkTimer);
    terminarPaseo = () => {};
    resolve(win && !win.isDestroyed() ? win.getPosition()[0] - x0 : 0);
  };
  walkTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return terminarPaseo();
    i++;
    win.setPosition(Math.round(x0 + ((target - x0) * i) / steps), y);
    if (i >= steps) terminarPaseo();
  }, 16);
}));
ipcMain.on("stop-walk", () => terminarPaseo());

ipcMain.handle("ask", async (_e, text, opciones = {}) => {
  currentAbort?.abort();
  currentAbort = new AbortController();
  let citas = [], conMusica = false;
  if (settings.usarClaude && claude.disponible() && sobreTope()) send("status", `💸 Llegaste al tope de ${settings.limiteMensual} US$ de este mes en Claude: respondo con mi cerebro local.`);
  try {
    const answer = await brain.ask(history, text, tools, {
      onStatus: (s) => send("status", s),
      onToken: (t) => send("token", t),
      onCitas: (c) => { citas = c; c.forEach((x) => citasAbribles.add(x.ruta)); },
      signal: currentAbort.signal,
      cerebro: { claude: settings.usarClaude && !sobreTope(), docsEnClaude: settings.docsEnClaude },
      prepararLocal: prepararModelo,
      porVoz: !!opciones.porVoz,
      onMusica: () => { conMusica = true; },
    });
    return { answer, citas, conMusica, musicaSonando: require("./musica").estaSonando() };
  } catch (e) {
    if (e.name === "AbortError") return { answer: "", cancelled: true };
    const msg = /fetch failed|ECONNREFUSED/.test(String(e.message + (e.cause?.code || "")))
      ? brain.SIN_LMSTUDIO
      : "Miau, algo falló: " + e.message;
    return { answer: msg, error: true };
  }
});
ipcMain.on("cancel", () => currentAbort?.abort());
ipcMain.on("voz-cortada", (_e, { oido, motivo }) => {
  // Sin «oido» lo cortado era una frase suelta, no una respuesta: solo queda en el registro
  if (oido !== null) brain.respuestaCortada(history, oido);
  aprendizaje.registrarVoz("cortada", { motivo, oidoCaracteres: (oido || "").length });
  console.log(`[voz] cortada por ${motivo}: oyó ${(oido || "").length} caracteres`);
});
// ---------- Recordatorios: se revisan cada 10 s y se reenvían si la ventana no confirma ----------
const enviados = new Map();
function revisarRecordatorios() {
  if (!win || win.isDestroyed()) return;
  const ahora = Date.now();
  for (const r of recordatorios.vencidos(ahora)) {
    if (ahora - (enviados.get(r.id) || 0) < 60000) continue;
    enviados.set(r.id, ahora);
    const frase = recordatorios.fraseAviso(r, ahora);
    send("recordatorio", { id: r.id, frase });
    try { new Notification({ title: "Merlín", body: frase, silent: true }).show(); } catch {}
  }
}
ipcMain.on("recordatorio-entregado", (_e, id) => { recordatorios.entregado(id); enviados.delete(id); });
ipcMain.handle("oido-nativo", () => oidoNativo.disponible());
// Los fallos y las transcripciones lentas quedan en el registro (sin el audio ni el texto): la consola se pierde
// al abrir Merlín desde el acceso directo, y así se puede diagnosticar si la precisión baja
ipcMain.handle("transcribir", async (_e, audio) => {
  const r = await oidoNativo.transcribir(audio);
  const segundos = +(audio.length / 16000).toFixed(1);
  if (r.error) aprendizaje.registrarVoz("whisper-fallo", { motivo: String(r.error).slice(0, 120), segundos });
  else if (r.ms > 5000) aprendizaje.registrarVoz("whisper-lento", { ms: r.ms, segundos });
  return r;
});
ipcMain.handle("guardar-clave", async (_e, clave) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, motivo: "Windows no permite cifrarla en este momento" };
  claude.configurar(clave);
  const r = await claude.comprobar();
  // Un fallo de red no dice nada de la clave; una clave rechazada no se guarda
  if (r.ok) fs.writeFileSync(CLAVE_FILE, safeStorage.encryptString(clave));
  else { claude.configurar(""); cargarClave(); }
  return r;
});

ipcMain.on("log", (_e, ...a) => console.log("[gatito]", ...a));
ipcMain.on("open-url", (_e, u) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); });
ipcMain.on("set-voz", (_e, activa) => { settings.voz = !!activa; saveSettings(); });
ipcMain.on("abrir-cita", (_e, ruta) => { if (citasAbribles.has(ruta)) tools.run("abrir_archivo", { path: ruta }); });
ipcMain.on("prueba-voz-guardar", (_e, nombre, datos) => {
  if (PRUEBA_VOZ) { fs.mkdirSync(PRUEBA_VOZ, { recursive: true }); fs.writeFileSync(path.join(PRUEBA_VOZ, path.basename(nombre)), Buffer.from(datos)); }
});
ipcMain.on("test-done", (_e, result) => { console.log("TEST_WHISPER_RESULT", JSON.stringify(result)); app.exit(0); });

// ---------- LM Studio: asegurarse de que el servidor está encendido ----------
async function ensureLmStudio() {
  const lms = path.join(require("os").homedir(), ".lmstudio", "bin", "lms.exe");
  if (!fs.existsSync(lms)) return;
  const correr = (args) => new Promise((r) => execFile(lms, args, { windowsHide: true }, (_e, salida) => r(String(salida || ""))));
  try { await fetch(`${brain.LMSTUDIO_URL}/models`, { signal: AbortSignal.timeout(3000) }); }
  catch { await correr(["server", "start"]); }
  // Deja el modelo cargado con los ajustes que van mejor en esta CPU, para que baste con abrir la app
  const modelo = process.env.LMSTUDIO_MODEL || "google/gemma-3-4b";
  const estado = brain.estadoCarga(await correr(["ps", "--json"]), modelo);
  if (estado === "correcta") return;
  if (estado === "incorrecta") { console.log("[modelo] cargado con otros ajustes, lo recargo"); await correr(["unload", modelo]); }
  await correr(["load", modelo, "--gpu", "off", "--context-length", String(brain.CARGA.contexto), "--parallel", String(brain.CARGA.paralelo), "-y"]);
}
// Deja el modelo listo para la primera pregunta. Si falla, el programa funciona igual, solo que esa pregunta tarda más.
// Con Claude activo solo se carga cuando hace falta: ahorra 3,3 GB de memoria y la CPU que Whisper y Piper necesitan.
let preparandoModelo = null;
function prepararModelo() {
  return (preparandoModelo ??= (async () => {
    try {
      await ensureLmStudio();
      console.log(`[modelo] instrucciones precalentadas en ${await brain.precalentar()} ms`);
    } catch (e) { console.log("[modelo] sin precalentar:", e.message); preparandoModelo = null; }
  })());
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === "media");
  serveApp();
  cargarClave();
  if (!TEST_WAV && !PRUEBA_VOZ) {
    const datos = process.env.MERLIN_DATOS || app.getPath("userData");
    aprendizaje.iniciar(datos);
    recordatorios.iniciar(datos);
    app.setAppUserModelId("gatito-brujo");
    // Tras el saludo: un aviso vencido mientras la app estaba cerrada no debe pisarlo
    setTimeout(() => { revisarRecordatorios(); setInterval(revisarRecordatorios, 10000); }, 12000);
  }
  // Con el modelo de por medio, la prueba mide lo que se encuentra un usuario con el programa ya listo
  if (PRUEBA_VOZ && !argumento("prueba-voz-modo")) await prepararModelo();
  createWindow();
  if (TEST_WAV) return;
  if (PRUEBA_VOZ) { setTimeout(() => { console.log("PRUEBA_VOZ: tiempo agotado"); app.exit(1); }, 30 * 60 * 1000); return; }
  globalShortcut.register("Control+Shift+Space", () => send("toggle-listen"));
  globalShortcut.register("Control+Shift+K", () => send("open-input"));
  if (!claudeActivo()) prepararModelo();
  setTimeout(arrancarIndexador, 8000); // deja que la app termine de arrancar primero
});

app.on("second-instance", () => { win?.show(); send("open-input"); });
app.on("will-quit", () => { globalShortcut.unregisterAll(); indexer?.kill(); });
app.on("window-all-closed", () => app.quit());
