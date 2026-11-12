// Lógica del gatito brujo en el escritorio
import { crearAvatar } from "./avatar.js";
import { crearVoz } from "./voz.js";
import { crearOido } from "./oido.js";
import { detectarInvocacion, esOrdenCallar, esEco, esMuletilla, limpiarTranscripcion, crearSelectorOido } from "./oido-nucleo.js";
import { fragmentar, paraVoz, sinMiau, variante, claveFrase, esMuletillaSuelta, saludoHablado, FRASES } from "./voz-nucleo.js";

const api = window.cat;
const $ = (id) => document.getElementById(id);
const wrap = $("catWrap"), bubble = $("bubble"), panel = $("panel"), input = $("input"), catVideo = $("catVideo");
const params = new URLSearchParams(location.search);
const TEST = params.has("test");
const PRUEBA_VOZ = params.get("pruebavoz");

let settings = { voz: true, paseos: true, name: "Merlín" };
let state = "idle";           // idle | listening | thinking | talking | sleeping | walking
let lastActivity = Date.now();
let busy = false;
let hideTimer;
let avatar = null;            // vídeos de "Imagenes Merlin"; si no se pueden cargar, se usa el SVG

function setState(s, mirandoIzquierda = false) {
  state = s;
  wrap.classList.remove("idle", "listening", "thinking", "talking", "sleeping", "walking", "left", "right");
  wrap.classList.add(s);
  avatar?.estado(s, mirandoIzquierda);
}
const touch = () => { lastActivity = Date.now(); if (state === "sleeping") setState("idle"); };

// ---------- Ventana: clics a través de las zonas transparentes ----------
let ignoring = true, dragging = null;
document.addEventListener("mousemove", (e) => {
  const bajo = document.elementFromPoint(e.clientX, e.clientY);
  const over = !!bajo?.closest(".hit") && (bajo !== catVideo || !avatar || avatar.opacidadEn(e.clientX, e.clientY) > 0.25);
  const want = !(over || dragging || !panel.classList.contains("hidden") && document.activeElement === input);
  if (want !== ignoring) { ignoring = want; api.setIgnore(want); }
});

// ---------- Arrastrar / clic / clic derecho sobre el gatito ----------
const dragTargets = [$("body"), catVideo];
const setCursor = (c) => dragTargets.forEach((t) => (t.style.cursor = c));
for (const target of dragTargets) {
  target.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = { x: e.screenX, y: e.screenY, moved: false };
    api.stopWalk(); if (state === "walking") setState("idle");
  });
  target.addEventListener("contextmenu", (e) => { e.preventDefault(); api.contextMenu(); });
}
document.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const dx = e.screenX - dragging.x, dy = e.screenY - dragging.y;
  if (!dragging.moved && Math.hypot(dx, dy) < 4) return;
  dragging.moved = true; dragging.x = e.screenX; dragging.y = e.screenY;
  setCursor("grabbing");
  api.drag(dx, dy);
});
document.addEventListener("mouseup", () => {
  if (!dragging) return;
  const wasClick = !dragging.moved;
  dragging = null; setCursor("");
  touch();
  if (wasClick) {
    if (state === "listening") return cerrarVentana();
    purr();
    togglePanel();
  }
});

function purr() {
  wrap.classList.add("happy");
  setTimeout(() => wrap.classList.remove("happy"), 700);
}

// ---------- Ojos que siguen al ratón ----------
const pupils = [...document.querySelectorAll(".pupil")], shines = [...document.querySelectorAll(".shine")];
api.onCursor(({ x, y }) => {
  if (state === "sleeping") return;
  const r = $("cat").getBoundingClientRect();
  const ex = r.left + r.width * 0.5, ey = r.top + r.height * (114 / 232);
  const dx = x - ex, dy = y - ey, d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, d / 300);
  const ox = (dx / d) * 5 * k, oy = (dy / d) * 4 * k + (state === "thinking" ? -3 : 0);
  pupils.forEach((p) => (p.style.transform = `translate(${ox}px, ${oy}px)`));
  shines.forEach((s) => (s.style.transform = `translate(${ox * 0.5}px, ${oy * 0.5}px)`));
});

// Parpadeo
(function blink() {
  if (state !== "sleeping") { $("eyes").classList.add("blink"); setTimeout(() => $("eyes").classList.remove("blink"), 170); }
  setTimeout(blink, 2500 + Math.random() * 4000);
})();

// ---------- Bocadillo ----------
function showBubble({ q = "", text = "", status = "" } = {}) {
  clearTimeout(hideTimer);
  bubble.classList.remove("hidden");
  $("q").textContent = q;
  renderAnswer(text);
  $("citas").replaceChildren();
  $("status").textContent = status;
}
// Citas literales: las pone el programa a partir del archivo, no el modelo. Clic para abrir el documento.
function renderCitas(citas) {
  $("citas").replaceChildren(...citas.map((c) => {
    const b = document.createElement("button"), f = document.createElement("span"), l = document.createElement("span");
    b.type = "button"; b.className = "cita"; b.title = c.ruta;
    f.className = "fuente"; f.textContent = `📜 ${c.nombre}${c.loc ? " · " + c.loc : ""}`;
    l.className = "literal"; l.textContent = `«${c.texto}»`;
    b.append(f);
    if (c.texto) b.append(l); // un escaneo se puede abrir, pero no hay texto que citar
    b.addEventListener("click", () => api.abrirCita(c.ruta));
    return b;
  }));
  bubble.scrollTop = 0;
}
function renderAnswer(text) {
  // Las comillas también: un enlace con " rompería el atributo data-url e inyectaría atributos (style, por ejemplo)
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  $("answer").innerHTML = esc
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a data-url="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a data-url="$2">$2</a>')
    .replace(/\n/g, "<br>");
  bubble.scrollTop = bubble.scrollHeight;
}
$("answer").addEventListener("click", (e) => { const a = e.target.closest("a[data-url]"); if (a) api.openUrl(a.dataset.url); });
function hideBubbleLater(ms = 15000) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!busy && !bubble.matches(":hover")) bubble.classList.add("hidden"); else hideBubbleLater(5000); }, ms);
}
// Un recordatorio que vence: se muestra y se dice, y solo entonces se confirma como entregado
api.onRecordatorio(({ id, frase }) => {
  touch(); api.stopWalk();
  if (state === "walking" || state === "sleeping") setState("idle");
  showBubble({ text: `⏰ ${frase}` });
  speak(frase, true); // un aviso pedido suena aunque la voz automática esté silenciada
  hideBubbleLater(60000);
  api.recordatorioEntregado(id);
});
api.onSay((t) => { ultimaRespuesta = t; showBubble({ text: t }); refrescarAltavoces(); speak(t); hideBubbleLater(6000); });

// ---------- Panel de texto ----------
function togglePanel(force) {
  const open = force ?? panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  if (open) { api.focus(); ignoring = false; setTimeout(() => input.focus(), 30); }
  else { input.blur(); modoClave(false); }
}
api.onOpenInput(() => { touch(); togglePanel(true); });
input.addEventListener("keydown", (e) => { if (e.key === "Escape") togglePanel(false); });
panel.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = input.value.trim(); if (!t) return;
  input.value = "";
  if (pidiendoClave) return guardarClave(t);
  ask(t);
});

// La clave de Claude se escribe en la misma caja, oculta. No pasa por la conversación ni por el bocadillo.
let pidiendoClave = false;
function modoClave(activo) {
  pidiendoClave = activo;
  input.type = activo ? "password" : "text";
  input.value = "";
  input.placeholder = activo ? "Pega tu clave de Claude (Esc para cancelar)" : "Pídeme algo... (Esc para cerrar)";
}
api.onPedirClave(() => { touch(); modoClave(true); togglePanel(true); });
async function guardarClave(clave) {
  togglePanel(false);
  showBubble({ status: "🔑 Probando la clave..." });
  const r = await api.guardarClave(clave);
  const t = r.ok ? "Clave guardada. Ahora pienso mucho más rápido." : `No pude usar esa clave: ${r.motivo}.`;
  showBubble({ text: t }); speak(t); hideBubbleLater(8000);
}

// ---------- Voz (lectura en voz alta) ----------
const voz = crearVoz({
  alEmpezar: () => { if (state !== "listening") setState("talking"); refrescarAltavoces(); },
  alTerminar: () => {
    finVoz = Date.now();
    if (state === "talking") setState(busy ? "thinking" : "idle");
    refrescarAltavoces();
  },
  // Pasado el segundo de silencio tras la respuesta, vuelve a escuchar sin que haya que llamarlo
  alDescansar: () => {
    if (seguirTrasHablar && !busy) { seguirTrasHablar = false; abrirVentana(ventanaAlTerminar); }
  },
  log: (...a) => api.log(...a),
});
window.__voz = voz; // diagnóstico
let ultimaRespuesta = "";
// Altavoces: el de la caja activa o silencia la voz; el del bocadillo repite o detiene la respuesta
function refrescarAltavoces() {
  const v = $("voz"), e = $("escuchar"), suena = voz.sonando();
  const textoVoz = settings.voz ? "Voz activada: clic para silenciar" : "Voz silenciada: clic para activar";
  v.textContent = settings.voz ? "🔊" : "🔇"; v.title = textoVoz; v.setAttribute("aria-label", textoVoz);
  v.classList.toggle("silencio", !settings.voz);
  const textoEsc = suena ? "Detener la voz" : "Escuchar la respuesta";
  e.textContent = suena ? "⏹" : "🔊"; e.title = textoEsc; e.setAttribute("aria-label", textoEsc);
  e.classList.toggle("sonando", suena);
  e.classList.toggle("hidden", !ultimaRespuesta && !suena);
}
function callar(motivo = "usuario") {
  avisarCorte(motivo);
  voz.callar();
  if (state === "talking") setState(busy ? "thinking" : "idle");
  refrescarAltavoces();
}
$("voz").addEventListener("click", () => {
  touch();
  settings.voz = !settings.voz;
  api.setVoz(settings.voz);
  if (!settings.voz) callar(); else refrescarAltavoces();
});
$("escuchar").addEventListener("click", () => {
  touch();
  if (voz.sonando()) return callar("botón");
  speak(ultimaRespuesta, true); // repetir es una petición expresa: suena aunque la voz automática esté silenciada
});
function speak(text, forzar = false) {
  if (!settings.voz && !forzar) return;
  const t = paraVoz(text); if (!t) return;
  dichoReciente = (dichoReciente + " " + t).slice(-800); // para reconocer su propia voz en el micrófono
  voz.hablar(t);
  refrescarAltavoces();
}
api.onSettings((s) => {
  const antes = settings.perfilVoz;
  settings = { ...settings, ...s };
  aplicarEscucha();
  if (settings.perfilVoz !== antes) {
    voz.perfil(settings.perfilVoz);
    // Al elegir un perfil en el menú, se oye de inmediato cómo suena
    voz.callar();
    voz.hablar("Así sueno ahora. ¿Te parece, o sigo probando trucos?");
  }
  if (!settings.voz) callar(); else refrescarAltavoces();
});

// ---------- Preguntar a la IA ----------
let preguntaActual = 0;
async function ask(text, { porVoz = false } = {}) {
  const estaPregunta = ++preguntaActual;
  touch();
  cerrarVentana({ silencioso: true });
  seguirTrasHablar = false;
  busy = true;
  avisarCorte(porVoz ? "nueva pregunta por voz" : "nueva pregunta escrita");
  voz.callar();
  ultimaRespuesta = "";
  refrescarAltavoces();
  setState("thinking");
  let shown = "", spokenUpTo = 0, miauDicho = false, conDocumentos = false;
  const yaDichas = new Set();
  // Las frases se juntan antes de enviarlas: dos frases generadas de una vez enlazan mejor que dos sueltas
  let lote = "", primeraDicha = false;
  const soltarLote = () => { if (lote.trim()) speak(lote); lote = ""; };
  showBubble({ q: "Tú: " + text, status: "🪄 Pensando..." });

  // Dice una frase de la respuesta, con un solo «miau» como mucho
  const decirFrase = (frase) => {
    let f = frase;
    const clave = claveFrase(f);
    if (clave && yaDichas.has(clave)) return;
    if (esMuletillaSuelta(f) && yaDichas.size) return;
    if (clave) yaDichas.add(clave);
    if (/miau/i.test(f)) { if (miauDicho) f = sinMiau(f); miauDicho = true; }
    if (f.trim().length > 1) lote += (lote ? " " : "") + f.trim();
    // Con menos texto la voz alcanza al modelo y se oye un silencio a media respuesta
    if (lote.length >= 150) soltarLote();
  };

  // Mientras el modelo piensa, Merlín no se queda mudo. Se calla en cuanto empieza a responder.
  let esperas = 0;
  const avisos = [];
  const avisarEspera = (lista) => { if (!shown && esperas < 2) { esperas++; speak(variante(lista)); } };
  const programar = (lista, ms) => avisos.push(setTimeout(() => avisarEspera(lista), ms));
  programar(FRASES.pensando, 5000);
  programar(FRASES.sigo, 45000);

  const offTok = onToken((tok) => {
    shown += tok;
    avisos.forEach(clearTimeout);
    $("status").textContent = "";
    renderAnswer(shown);
    if (state === "thinking" && !settings.voz) setState("idle");
    // Con documentos se espera al texto final, ya revisado: no se dice en voz alta nada que luego se descarte
    if (conDocumentos) return;
    // Lee en voz alta frase a frase mientras se genera
    const rest = shown.slice(spokenUpTo), m = rest.match(/^[\s\S]*?[.!?…](\s|$)/); // los mismos cortes que fragmentar()
    if (m && m[0].trim().length > 2) {
      decirFrase(m[0]); spokenUpTo += m[0].length;
      // La primera frase no espera a juntar texto: oír algo pronto pesa más que un posible silencio después.
      // Solo aquí, con el modelo: una respuesta fija partida ya no coincidiría con su audio grabado.
      if (!primeraDicha && lote.length >= 25) { primeraDicha = true; soltarLote(); }
    }
  });
  const offStatus = onStatus((s) => {
    $("status").textContent = s; shown = ""; spokenUpTo = 0; yaDichas.clear(); lote = ""; primeraDicha = false; renderAnswer("");
    if (/[📚📖]/u.test(s)) conDocumentos = true;
    avisos.splice(0).forEach(clearTimeout);
    // Breve demora: lo que responde el programa en un instante no necesita «déjame revisar»
    if (esperas === 0) programar(FRASES.revisando, 2000);
    programar(FRASES.sigo, 45000);
  });
  const respuesta = await api.ask(text, { porVoz });
  const { answer, citas = [], conMusica = false } = respuesta;
  if (respuesta.musicaSonando !== undefined) musicaSonando = respuesta.musicaSonando;
  offTok(); offStatus();
  avisos.forEach(clearTimeout);
  if (estaPregunta !== preguntaActual) return; // la interrumpió otra pregunta: la nueva manda
  busy = false;
  if (answer) {
    ultimaRespuesta = answer;
    refrescarAltavoces();
    renderAnswer(answer);
    // El programa puede retocar el texto final; se cuentan frases para no repetir lo ya dicho
    fragmentar(paraVoz(answer)).forEach(decirFrase);
    soltarLote();
  }
  renderCitas(citas);
  $("status").textContent = "";
  if (state === "thinking") setState("idle");
  hideBubbleLater(citas.length ? 90000 : 20000); // da tiempo a leer las citas
  // Si le hablaron, se sigue la conversación sin volver a llamarlo, en cuanto termine de hablar.
  // Con música sonando no: la letra de la canción se tomaría por preguntas. Hay que llamarlo por su nombre.
  if (porVoz && answer && !(conMusica && musicaSonando)) {
    ventanaAlTerminar = VENTANA_SEGUIMIENTO;
    if (voz.sonando()) seguirTrasHablar = true;
    else abrirVentana(VENTANA_SEGUIMIENTO);
  }
  respuestaEnCurso = !!answer;
}

// Si cortan a Merlín a media respuesta, el modelo debe saber hasta dónde se oyó. Y queda registrado quién lo cortó.
let respuestaEnCurso = false;
function avisarCorte(motivo) {
  if (voz.sonando()) api.vozCortada({ motivo, oido: respuestaEnCurso ? voz.loDicho(ultimaRespuesta) : null });
  voz.reiniciarLinea();
  respuestaEnCurso = false;
}
// Pequeño bus para poder desuscribirse de los eventos de streaming
const listeners = { token: new Set(), status: new Set() };
api.onToken((t) => listeners.token.forEach((f) => f(t)));
api.onStatus((s) => listeners.status.forEach((f) => f(s)));
const onToken = (f) => (listeners.token.add(f), () => listeners.token.delete(f));
const onStatus = (f) => (listeners.status.add(f), () => listeners.status.delete(f));

// ---------- Oído: micrófono + whisper.cpp nativo, o Whisper con WebAssembly si el nativo no está o falla ----------
let worker = null, whisperReady = false, oidoListo = false, oidoNativo = false, reqId = 0;
const pending = new Map();
function cargarWorker() {
  if (worker) return;
  api.log("[oido] uso Whisper con WebAssembly");
  worker = new Worker("whisper-worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") $("badge").textContent = `🎧 preparando oído mágico ${data.pct}%`;
    if (data.type === "ready") { whisperReady = true; oidoListo = true; $("badge").textContent = ""; api.log(`Whisper listo (${data.threads} hilos, aislado=${data.isolated})`); atenderSiguiente(); }
    if (data.type === "result" || data.type === "error") { pending.get(data.id)?.(data); pending.delete(data.id); }
  };
  // Si el worker no llega a arrancar, las frases pendientes no deben quedarse esperando para siempre:
  // mientras espera una, no se atiende ninguna otra y Merlín parece sordo
  worker.onerror = (e) => {
    api.log("[oido] el Whisper de respaldo falló:", e.message || "sin detalle");
    for (const [id, res] of pending) res({ error: "el Whisper de respaldo no arrancó" });
    pending.clear();
    worker = null;
  };
  worker.postMessage({ type: "load" });
}
const LIMITE_WASM_MS = 45000;
const transcribirWasm = (audio) => new Promise((res) => {
  cargarWorker();
  const id = ++reqId;
  const limite = setTimeout(() => { if (pending.delete(id)) res({ error: "el Whisper de respaldo tardó demasiado" }); }, LIMITE_WASM_MS);
  pending.set(id, (r) => { clearTimeout(limite); res(r); });
  worker.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
});
// Un fallo suelto de whisper.cpp solo manda esa frase al respaldo de WebAssembly (ver crearSelectorOido)
let selectorOido = crearSelectorOido({ instalado: false });
// El respaldo solo se usa si ya está cargado: cargarlo la primera vez descarga el modelo y tarda minutos, y en ese
// tiempo no se atendería ninguna frase. Mientras tanto se sigue con whisper.cpp y el respaldo se prepara aparte.
async function transcribe(audio) {
  const respaldoListo = whisperReady;
  if (selectorOido.usarNativo() || (oidoNativo && !respaldoListo)) {
    const r = await api.transcribir(audio);
    if (!r.error) { selectorOido.exito(); return r; }
    const descansa = selectorOido.fallo();
    api.log(`[oido] falló whisper.cpp: ${r.error}${descansa ? " (varios seguidos: preparo el respaldo)" : ""}`);
    if (descansa) cargarWorker();
    if (!respaldoListo) return r; // esa frase se pierde, pero el oído sigue atendiendo las siguientes
  }
  return transcribirWasm(audio);
}

// Merlín escucha siempre, pero solo atiende si lo llaman por su nombre. Tras responder queda una «ventana»
// de conversación en la que no hace falta repetirlo. Lo que no va dirigido a él se descarta sin guardarlo.
const VENTANA_SEGUIMIENTO = 10000, VENTANA_LLAMADA = 10000, FACTOR_MIENTRAS_HABLA = 2.5, COLA_ECO = 1500, UMBRAL_ECO = 0.5;
let seguirTrasHablar = false, ventanaAlTerminar = VENTANA_SEGUIMIENTO, dichoReciente = "", finVoz = 0, posibleEco = false;
let ventanaAbierta = false, ventanaManual = false, ventanaTimer = null;
let fraseEnVentana = false, atendiendo = false, enEspera = null;

let musicaSonando = false, colaMusica = null;
const FRASE_CON_MUSICA_MS = 6000, SOLAPE_MUESTRAS = 2 * 16000;
const oido = crearOido({
  limiteFrase: () => (musicaSonando ? FRASE_CON_MUSICA_MS : undefined),
  factor:() => (voz.sonando() || voz.enDescanso() ? FACTOR_MIENTRAS_HABLA : 1), // el eco de su propia voz no debe parecer alguien hablando
  log: (...a) => api.log("[oido]", ...a),
  alEstado: (e, detalle) => {
    $("oreja").classList.toggle("hidden", e !== "activo");
    if (e === "sinMic") $("badge").textContent = detalle === "NotAllowedError" ? "🎤 Windows no me deja usar el micrófono" : "🎤 no encuentro micrófono";
    else if ($("badge").textContent.startsWith("🎤")) $("badge").textContent = "";
    if (e === "sinMic" && ventanaManual) {
      cerrarVentana({ silencioso: true });
      showBubble({ text: "Miau... no puedo usar el micrófono. Revisa en Windows: Configuración › Privacidad › Micrófono › permitir a las apps de escritorio." });
      hideBubbleLater(10000);
    }
  },
  alEmpezarVoz: () => {
    posibleEco = voz.sonando() || voz.enDescanso() || Date.now() - finVoz < COLA_ECO; // el eco de la voz dura un poco más que la voz
    fraseEnVentana = ventanaAbierta && !busy && !voz.sonando() && !voz.enDescanso();
    if (!fraseEnVentana) return;
    clearTimeout(ventanaTimer); // mientras hable no se le corta
    touch();
    $("status").textContent = "👂 Te escucho...";
  },
  alDescartar: () => { // era un golpe o un ruido: la conversación sigue abierta
    if (!fraseEnVentana) return;
    fraseEnVentana = false;
    $("status").textContent = "";
    abrirVentana(VENTANA_SEGUIMIENTO, ventanaManual);
  },
  alSegmento: (audio, ms) => {
    // Con música la frase se corta por tiempo y puede partir la orden: cada trozo repite el final del anterior
    let completo = audio;
    if (musicaSonando && colaMusica) {
      completo = new Float32Array(colaMusica.length + audio.length);
      completo.set(colaMusica); completo.set(audio, colaMusica.length);
    }
    colaMusica = musicaSonando ? audio.slice(-SOLAPE_MUESTRAS) : null;
    const frase = { audio: completo, ms, enVentana: fraseEnVentana, posibleEco };
    fraseEnVentana = false;
    if (frase.enVentana) { clearTimeout(ventanaTimer); ventanaAbierta = false; }
    // Whisper va de una en una; si llegan más, solo importa la última
    enEspera = frase;
    atenderSiguiente();
  },
});

async function atenderSiguiente() {
  if (atendiendo || !enEspera || !oidoListo) return;
  atendiendo = true;
  const frase = enEspera; enEspera = null;
  try { await atender(frase); } finally { atendiendo = false; atenderSiguiente(); }
}

async function atender({ audio, enVentana, posibleEco }) {
  if (enVentana) { setState("thinking"); showBubble({ status: "✍️ Transcribiendo..." }); }
  const r = await transcribe(audio);
  if (r.error) api.log("[oido] Whisper falló:", r.error);
  const texto = limpiarTranscripcion(r.text || "");
  if (!texto) {
    if (enVentana) { setState("idle"); $("status").textContent = ""; soltarMicSiToca(); }
    return;
  }
  // Su propia voz colada por el micrófono no cuenta como que le hablen
  const { invocado, resto } = detectarInvocacion(texto);
  const peticion = invocado ? resto : texto;
  // «Merlín, cállate» debe funcionar aunque su respuesta también contenga esas palabras
  const ordenCallar = peticion && invocado && esOrdenCallar(peticion);
  if (posibleEco && !ordenCallar && esEco(texto, dichoReciente, UMBRAL_ECO)) { api.log(`[oido] eco descartado (${r.ms} ms)`); if (enVentana) abrirVentana(VENTANA_SEGUIMIENTO); return; }
  if (!enVentana && !invocado) { api.log(`[oido] no era para mí (${r.ms} ms)`); return; }
  // En la conversación, un «ajá» suelto no es una pregunta, salvo que Merlín acabe de preguntar algo
  if (enVentana && !invocado && esMuletilla(texto) && !/\?\s*$/.test(ultimaRespuesta)) { api.log(`[oido] muletilla (${r.ms} ms): ${texto}`); $("status").textContent = ""; return abrirVentana(VENTANA_SEGUIMIENTO); }
  api.log(`[oido] Whisper (${r.ms} ms): ${texto}`);
  touch(); api.stopWalk();
  if (peticion && esOrdenCallar(peticion)) {
    api.log(`[oido] orden de callar (sonaba: ${voz.sonando()}, música: ${musicaSonando})`);
    // Si él no está hablando y hay música, lo que se quiere callar es la música
    if (musicaSonando && !voz.sonando()) return ask("pausa la música", { porVoz: true });
    preguntaActual++; api.cancel(); busy = false; seguirTrasHablar = false;
    callar("orden de callar"); setState("idle");
    bubble.classList.add("hidden");
    return soltarMicSiToca();
  }
  if (!peticion) { // Solo dijo «Merlín»: contesta y espera la pregunta
    callar("su nombre");
    const t = variante(FRASES.invocado);
    showBubble({ text: t }); speak(t);
    hideBubbleLater(VENTANA_LLAMADA);
    if (voz.sonando()) { ventanaAlTerminar = VENTANA_LLAMADA; seguirTrasHablar = true; return; }
    return abrirVentana(VENTANA_LLAMADA);
  }
  ask(peticion, { porVoz: true });
}
window.__preguntar = (t) => ask(t); // diagnóstico: preguntar sin abrir la caja ni quitar el foco a otra ventana
window.__conversacion = () => ({ ventanaAbierta, busy, state, sonando: voz.sonando() }); // diagnóstico

function abrirVentana(ms, manual = false) {
  clearTimeout(ventanaTimer);
  ventanaAbierta = true; ventanaManual = manual;
  oido.iniciar();
  $("mic").classList.add("on");
  if (state === "idle" || state === "sleeping") setState("listening");
  const vencer = () => {
    if (oido.oyendoVoz()) { ventanaTimer = setTimeout(vencer, 500); return; } // sigue sonando algo: espera a que termine
    cerrarVentana({ avisar: ventanaManual });
  };
  ventanaTimer = setTimeout(vencer, ms);
}
function cerrarVentana({ silencioso = false, avisar = false } = {}) {
  clearTimeout(ventanaTimer);
  ventanaAbierta = false; ventanaManual = false;
  $("mic").classList.remove("on");
  if (state === "listening") setState("idle");
  if (avisar) { const t = variante(FRASES.noOido); showBubble({ text: t }); speak(t); hideBubbleLater(4000); }
  if (!silencioso) soltarMicSiToca();
}
// Con la escucha continua apagada, el micrófono solo está abierto mientras se conversa
const soltarMicSiToca = () => { if (!settings.escuchaContinua && !ventanaAbierta && !busy && !seguirTrasHablar) oido.detener(); };
function aplicarEscucha() {
  if (TEST || PRUEBA_VOZ) return;
  if (settings.escuchaContinua) oido.iniciar(); else soltarMicSiToca();
}

function toggleListen() {
  if (ventanaAbierta) return cerrarVentana();
  // Con música fuerte el micrófono apenas distingue la voz: el atajo es la vía segura para pausarla y hablarle
  if (musicaSonando) return ask("pausa la música", { porVoz: true });
  touch(); callar(); api.stopWalk();
  showBubble({ text: "", status: oidoListo ? "👂 Te escucho... (habla y haz una pausa)" : "👂 Te escucho... (la primera vez preparo el oído, puede tardar)" });
  abrirVentana(VENTANA_LLAMADA, true);
}
api.onToggleListen(toggleListen);
$("mic").addEventListener("click", toggleListen);

// ---------- Vida propia: paseos y siestas ----------
setInterval(async () => {
  const idleFor = Date.now() - lastActivity;
  if (state === "idle" && !busy && idleFor > 4 * 60 * 1000 && bubble.classList.contains("hidden")) setState("sleeping");
}, 5000);

(function wander() {
  setTimeout(async () => {
    const free = state === "idle" && !busy && !ventanaAbierta && !dragging && panel.classList.contains("hidden") && bubble.classList.contains("hidden");
    if (settings.paseos && free && !TEST && !PRUEBA_VOZ) {
      const dist = (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 380);
      setState("walking", dist < 0); wrap.classList.add(dist < 0 ? "left" : "right"); // el vídeo camina hacia la derecha
      const moved = await api.walk(dist);
      if (state === "walking") {
        // Si chocó con el borde, da la vuelta la próxima vez
        setState("idle");
        if (Math.abs(moved) < 20) { setState("walking", dist > 0); wrap.classList.add(dist < 0 ? "right" : "left"); await api.walk(-dist); if (state === "walking") setState("idle"); }
      }
    }
    wander();
  }, 25000 + Math.random() * 45000);
})();

// ---------- Icono de la bandeja del sistema (dibujado a partir del propio gatito) ----------
function makeTrayIcon() {
  if (avatar?.manifiesto.icono) {
    const icono = new Image();
    icono.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const g = c.getContext("2d");
      // La imagen trae las esquinas blancas: se recorta justo el cuadrado redondeado del icono
      g.beginPath(); g.roundRect(0, 0, 64, 64, 14); g.clip();
      g.drawImage(icono, 132, 132, 760, 760, 0, 0, 64, 64);
      api.trayIcon(c.toDataURL("image/png"));
    };
    icono.src = avatar.urlDe(avatar.manifiesto.icono);
    return;
  }
  const svg = $("cat").cloneNode(true);
  svg.setAttribute("viewBox", "30 -4 140 150"); svg.setAttribute("width", "64"); svg.setAttribute("height", "64");
  svg.querySelectorAll("#rings,#sparkles,#zzz").forEach((n) => n.remove());
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    c.getContext("2d").drawImage(img, 0, 0, 64, 64);
    api.trayIcon(c.toDataURL("image/png"));
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
}

// ---------- Arranque ----------
(async () => {
  settings = { ...settings, ...(await api.getSettings()) };
  voz.perfil(settings.perfilVoz);
  refrescarAltavoces();
  if (TEST) { cargarWorker(); return runWhisperTest(); }
  oidoNativo = await api.oidoNativo();
  selectorOido = crearSelectorOido({ instalado: oidoNativo });
  if (oidoNativo) { oidoListo = true; api.log("[oido] uso whisper.cpp nativo"); atenderSiguiente(); }
  else cargarWorker();
  wrap.classList.add("conVideo");
  catVideo.classList.remove("hidden");
  try {
    avatar = await crearAvatar(catVideo);
    avatar.estado(state);
    window.__avatar = avatar; // diagnóstico
    api.log("Avatar de vídeo listo:", JSON.stringify(avatar.diagnostico().fuentes));
  } catch (e) {
    api.log("Avatar de vídeo no disponible, uso el SVG:", e.message);
    avatar = null;
    wrap.classList.remove("conVideo");
    catVideo.classList.add("hidden");
  }
  makeTrayIcon();
  if (PRUEBA_VOZ) return probarVoz();
  aplicarEscucha();
  window.__oido = oido; // diagnóstico
  setTimeout(() => {
    const saludo = variante(FRASES.saludo).replace("{n}", settings.name);
    showBubble({ text: saludo });
    hideBubbleLater(9000);
    voz.grabadasListas.then(() => speak(saludoHablado(saludo)));
  }, 600);
})();

// Modo prueba: recorre la voz en el programa real, por el altavoz (ver prueba-voz.js)
async function probarVoz() {
  const { correrPruebaVoz } = await import("./prueba-voz.js");
  settings.voz = true;
  const FRASE_MEDIDA = "Hola, soy Merlín. ¿En qué te puedo ayudar hoy?";
  const frases = PRUEBA_VOZ === "medir"
    ? () => { voz.perfil("natural"); return [
      ["piper-natural-1", "Piper sin efectos, la misma frase que se grabó con Merlin", () => voz.hablar(FRASE_MEDIDA)],
      ["piper-natural-2", "Piper sin efectos, frase larga", () => voz.hablar("Es cómo las plantas fabrican su comida con luz, agua y dióxido de carbono. Magia verde, aunque sin mi estilo.")],
    ]; }
    : () => [
      ["1-frase-grabada", "Aviso fijo con la voz grabada de Merlin", () => speak(FRASES.revisando[0])],
      ["2-charla", "«hola», responde el programa", () => ask("hola")],
      ["3-gracias", "«gracias», responde el programa", () => ask("gracias")],
      ["4-respuesta-modelo", "Pregunta real al modelo, respuesta con Piper", () => ask("¿qué es la fotosíntesis? responde en dos frases")],
      ["5-pregunta-corta", "Otra pregunta real al modelo", () => ask("¿cuál es la capital de Chile?")],
    ].slice(0, PRUEBA_VOZ === "rapida" ? 3 : undefined); // «rapida»: sin el modelo, que en CPU tarda minutos
  await correrPruebaVoz({ api, voz, ask, modo: PRUEBA_VOZ, frases });
}

async function runWhisperTest() {
  try {
    const buf = await (await fetch("/__test.wav")).arrayBuffer();
    const ctx = new AudioContext({ sampleRate: 16000 });
    const audio = (await ctx.decodeAudioData(buf)).getChannelData(0).slice();
    const t0 = performance.now();
    while (!whisperReady) await new Promise((r) => setTimeout(r, 200));
    const loadMs = Math.round(performance.now() - t0);
    const r = await transcribe(audio);
    api.testDone({ ...r, loadMs, seconds: +(audio.length / 16000).toFixed(1), isolated: self.crossOriginIsolated });
  } catch (e) { api.testDone({ error: String(e) }); }
}
