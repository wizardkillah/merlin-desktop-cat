// Música: busca en YouTube, abre el video en el navegador predeterminado y controla la reproducción con las
// teclas multimedia de Windows. No usa cuenta ni clave. Las órdenes claras se resuelven sin preguntarle al modelo.
const { execFile } = require("child_process");
const { normalizar } = require("./charla");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const LIMITE_MS = 10000, PLAZO_PETICION_MS = 60000;
const ID_VIDEO = /^[\w-]{11}$/;

const urlBusqueda = (consulta) => `https://www.youtube.com/results?search_query=${encodeURIComponent(consulta)}`;
const urlVideo = (id) => `https://www.youtube.com/watch?v=${id}&autoplay=1`;

// Saca los videos de la página de resultados. Sin duración es una emisión en directo o un anuncio.
function leerResultados(html) {
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!m) return [];
  let datos;
  try { datos = JSON.parse(m[1]); } catch { return []; }
  const videos = [];
  (function recorrer(x) {
    if (!x || typeof x !== "object") return;
    if (x.videoRenderer) {
      const v = x.videoRenderer, titulo = v.title?.runs?.[0]?.text;
      if (ID_VIDEO.test(v.videoId || "") && titulo && v.lengthText) videos.push({ id: v.videoId, titulo, canal: v.ownerText?.runs?.[0]?.text || "" });
      return;
    }
    for (const k of Object.keys(x)) recorrer(x[k]);
  })(datos);
  return videos;
}

async function buscar(consulta) {
  const r = await fetch(urlBusqueda(consulta), {
    headers: { "User-Agent": UA, "Accept-Language": "es-CL,es;q=0.9", Cookie: "SOCS=CAI" }, // la cookie evita la pantalla de consentimiento
    signal: AbortSignal.timeout(LIMITE_MS),
  });
  if (!r.ok) throw new Error(`YouTube respondió ${r.status}`);
  return leerResultados(await r.text());
}

// El título tal cual suele traer «(Official Video)», «[HD]» o «| Canal»: en voz alta sobra
function tituloParaDecir(titulo) {
  const t = titulo
    .replace(/[(\[][^)\]]*[)\]]/g, " ")
    .replace(/\s[|｜].*$/, "")
    .replace(/\s+/g, " ").trim();
  return (t || titulo).slice(0, 90);
}

// Windows reenvía estas teclas al navegador que tenga el reproductor activo
const TECLAS = { reproducir: 0xb3, siguiente: 0xb0 };
function pulsarTecla(nombre) {
  const vk = TECLAS[nombre];
  const script = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class Teclas { [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e); }'; [Teclas]::keybd_event(${vk},0,1,[UIntPtr]::Zero); [Teclas]::keybd_event(${vk},0,3,[UIntPtr]::Zero)`;
  return new Promise((ok, mal) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8000 }, (e) => (e ? mal(e) : ok())));
}

// Lo que se sabe del reproductor. La tecla es la misma para pausar y seguir: sin esto, pausar lo pausado lo reanudaría.
let sonando = null, pidiendoCancion = 0;

const FRASES_MUSICA = {
  queCancion: "¿Qué quieres escuchar?",
  pausada: "Listo, en pausa.",
  yaPausada: "Ya está en pausa.",
  sigue: "Sigue la música.",
  yaSuena: "Ya está sonando.",
  siguiente: "Vamos con la siguiente.",
  sinConexion: "No pude llegar a YouTube. ¿Hay internet?",
};

async function reproducir(consulta, { abrir, buscarVideos = buscar }) {
  const q = (consulta || "").trim();
  if (!q) return { error: "Falta indicar qué reproducir." };
  let videos;
  try { videos = await buscarVideos(q); } catch (e) { return { error: FRASES_MUSICA.sinConexion, detalle: e.message }; }
  if (!videos.length) { // YouTube cambió su página o no hay resultados: al menos se ve la búsqueda
    await abrir(urlBusqueda(q));
    return { ok: true, soloBusqueda: true, consulta: q };
  }
  const v = videos[0];
  await abrir(urlVideo(v.id));
  sonando = true;
  return { ok: true, titulo: v.titulo, canal: v.canal, url: urlVideo(v.id) };
}

async function controlar(accion, { tecla = pulsarTecla } = {}) {
  if (accion === "pausar") {
    if (sonando === false) return { ok: true, frase: FRASES_MUSICA.yaPausada };
    await tecla("reproducir"); sonando = false;
    return { ok: true, frase: FRASES_MUSICA.pausada };
  }
  if (accion === "seguir") {
    if (sonando === true) return { ok: true, frase: FRASES_MUSICA.yaSuena };
    await tecla("reproducir"); sonando = true;
    return { ok: true, frase: FRASES_MUSICA.sigue };
  }
  if (accion === "siguiente") {
    await tecla("siguiente"); sonando = true;
    return { ok: true, frase: FRASES_MUSICA.siguiente };
  }
  return { error: `Acción desconocida: ${accion}` };
}

const QUE = "(?:musica|cancion|tema|video)";
const VERBOS = "(?:pon|ponme|poneme|pone|coloca|colocame|reproduce|reproduceme|reproducir|toca|tocame|busca|buscame|abre|abreme|quiero ver|quiero escuchar|quiero oir|escuchar|ver)";
const YOUTUBE = "(?:you ?tube|yutub|youtub|yutu)";
const CON_YOUTUBE = new RegExp(`^${VERBOS} (.+?) (?:en|de|por) ${YOUTUBE}$`);
const YOUTUBE_PRIMERO = new RegExp(`^(?:en|por) ${YOUTUBE} ${VERBOS} (.+)$`);
const CON_MUSICA = new RegExp(`^(?:pon|ponme|poneme|coloca|colocame|reproduce|reproduceme|toca|tocame|busca|buscame|quiero escuchar|quiero oir) (?:(?:la|una|esa|esta|el|un|algo de|un poco de) )?${QUE} (?:de |del |que se llama |llamada |llamado )?(.+)$`);
const SOLO_REPRODUCIR = /^(?:reproduce|reproduceme|quiero escuchar|quiero oir) (.+)$/;
const SIN_NADA = new RegExp(`^(?:pon|ponme|poneme|coloca|colocame|reproduce|reproduceme|toca|tocame|quiero escuchar|quiero oir) (?:(?:la|una|esa|el|un|algo de|un poco de) )?${QUE}$`);
const PAUSAR = new RegExp(`^(?:pausa|pausar|pon pausa|deten|detiene|para|parar|quita|apaga|silencia|corta|saca|pausa)(?: (?:la|el|esa|esta))? ${QUE}$|^pon(?:le)? pausa$|^pausa$`);
const SEGUIR = new RegExp(`^(?:sigue|continua|reanuda|vuelve a poner|retoma)(?: con)?(?: (?:la|el|esa|esta))? ${QUE}$|^reanuda$|^quita la pausa$|^dale play$`);
const SIGUIENTE = new RegExp(`^(?:siguiente|otra) ${QUE}$|^(?:pasa|salta|cambia)(?: de)?(?: (?:la|el|esa|esta|a la))? (?:siguiente )?${QUE}$|^pon(?:me)? (?:la siguiente|otra)$`);

// Quita lo que no ayuda a buscar: «la canción de Queen» → «Queen»
const limpiarConsulta = (q) => q.replace(new RegExp(`^(?:(?:la|una|esa|esta|el|un|algo de|un poco de) )?${QUE} (?:de |del |que se llama |llamada |llamado )?`), "").trim();

// Reconoce las órdenes claras de música. Devuelve { tipo: "reproducir", consulta } | { tipo: "control", accion } | { tipo: "pedir" } | null
function intencion(texto, ahora = Date.now()) {
  const t = normalizar(texto);
  if (!t) return null;
  if (PAUSAR.test(t)) return { tipo: "control", accion: "pausar" };
  if (SEGUIR.test(t)) return { tipo: "control", accion: "seguir" };
  if (SIGUIENTE.test(t)) return { tipo: "control", accion: "siguiente" };
  if (SIN_NADA.test(t)) { pidiendoCancion = ahora; return { tipo: "pedir" }; }
  const m = t.match(CON_YOUTUBE) || t.match(YOUTUBE_PRIMERO) || t.match(CON_MUSICA) || t.match(SOLO_REPRODUCIR);
  if (m) { pidiendoCancion = 0; const consulta = limpiarConsulta(m[1]); if (consulta) return { tipo: "reproducir", consulta }; }
  // Acaba de preguntar «¿qué quieres escuchar?»: lo siguiente es la canción, salvo que sea otra pregunta
  if (pidiendoCancion && ahora - pidiendoCancion < PLAZO_PETICION_MS && !/[¿?]/.test(texto)) { pidiendoCancion = 0; return { tipo: "reproducir", consulta: t }; }
  pidiendoCancion = 0;
  return null;
}

const reiniciar = () => { sonando = null; pidiendoCancion = 0; };
const estaSonando = () => sonando === true;

module.exports = { estaSonando, FRASES_MUSICA, leerResultados, buscar, reproducir, controlar, intencion, tituloParaDecir, urlVideo, urlBusqueda, reiniciar };
