// Herramientas que el gatito puede usar. Todo se ejecuta en local salvo la búsqueda web.
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const dns = require("dns").promises;
const docs = require("./documentos");
const musica = require("./musica");
const pantalla = require("./pantalla");
const recordatorios = require("./recordatorios");
const memoria = require("./memoria");
const conversaciones = require("./conversaciones");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

// Lo único que se abre: documentos, imágenes, audio, vídeo y carpetas. Es una lista de lo permitido y no de lo prohibido:
// Windows tiene decenas de tipos que ejecutan algo (.msc, .url, .iso, .chm, macros…) y una lista negra siempre deja alguno.
const EXT_ABRIBLES = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".tsv", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".txt", ".md", ".log", ".epub",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".tif", ".tiff",
  ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".wma", ".mp4", ".mkv", ".avi", ".mov", ".webm", ".wmv",
]);
// «programa.exe.» o «programa.exe »: Windows quita el punto o el espacio final y abriría el .exe
const NOMBRE_ENGANOSO = /[. ]$/;

const decode = (s) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

async function webSearch({ query, max = 5 }) {
  const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query) + "&kl=es-es", {
    headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" },
  });
  const html = await r.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < max) {
    let url = decode(m[1]);
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // anuncios
    results.push({ title: stripTags(m[2]), url, snippet: stripTags(m[3]) });
  }
  if (!results.length) return { query, results: [], note: "Sin resultados (o el buscador bloqueó la petición)." };
  return { query, results };
}

// Direcciones de este PC o de la red de casa: LM Studio, Voice Studio, el router… Una web no debe poder hacer que se pidan.
function esIpPrivada(ip) {
  const v4 = ip.replace(/^::ffff:/i, "");
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const s = ip.toLowerCase();
  return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}
async function destinoPublico(url, buscarIp = (h) => dns.lookup(h, { all: true })) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.lan$|\.home$|\.internal$/i.test(host)) return false;
  if (net.isIP(host)) return !esIpPrivada(host);
  try { return (await buscarIp(host)).every((d) => !esIpPrivada(d.address)); } catch { return false; }
}

async function readPage({ url }, { buscarIp } = {}) {
  if (!/^https?:\/\//i.test(url)) return { error: "Solo URLs http/https" };
  // Las redirecciones se siguen a mano para comprobar también cada destino
  let r;
  for (let saltos = 0; ; saltos++) {
    if (!(await destinoPublico(url, buscarIp))) return { error: "Por seguridad no leo direcciones de este PC ni de la red local." };
    r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(15000) });
    const destino = r.status >= 300 && r.status < 400 && r.headers.get("location");
    if (!destino) break;
    if (saltos >= 5) return { error: "Demasiadas redirecciones." };
    url = new URL(destino, url).toString();
  }
  const html = await r.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|tr|br)>/gi, "\n");
  const text = stripTags(body.replace(/\n/g, " ¶ ")).replace(/( ¶ )+/g, "\n").slice(0, 3500);
  return { url, title: title ? stripTags(title) : "", text };
}

function searchFiles({ name, max = 15 }) {
  const home = os.homedir();
  const roots = ["Desktop", "Escritorio", "Documents", "Documentos", "Downloads", "Descargas", "Pictures", "Imágenes", "Music", "Videos", "OneDrive"]
    .map((d) => path.join(home, d)).filter((p) => fs.existsSync(p));
  const terms = name.toLowerCase().split(/\s+/).filter(Boolean);
  const found = [];
  let visited = 0;
  const walk = (dir, depth) => {
    if (found.length >= max || depth > 5 || visited > 20000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      visited++;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (terms.every((t) => e.name.toLowerCase().includes(t))) {
        found.push({ path: full, type: e.isDirectory() ? "carpeta" : "archivo" });
        if (found.length >= max) return;
      }
      if (e.isDirectory()) walk(full, depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return { name, found };
}

// docsDb: base de datos del índice de documentos (src/documentos.js). Sin ella, solo funciona la búsqueda por nombre clásica.
// listaRaices: carpetas donde se permite abrir archivos (por defecto las personales; las pruebas usan una temporal)
function makeTools({ openExternal, openPath, docsDb = null, listaRaices }) {
  const notaIndice = () => {
    if (!docsDb) return "El índice de documentos no está disponible.";
    const e = docs.estadoIndice(docsDb);
    return e.pendientes ? `Aviso: aún estoy leyendo documentos, faltan ${e.pendientes}, así que puede haber más.` : "";
  };
  const impl = {
    buscar_web: webSearch,
    leer_pagina: readPage,
    buscar_archivos: ({ name, max = 15 }) => {
      const delIndice = docsDb && name ? docs.buscarNombre(docsDb, name, max) : [];
      if (delIndice.length) return { name, found: delIndice.map((f) => ({ path: f.ruta, type: f.tipo })) };
      return searchFiles({ name, max }); // índice vacío o todavía en construcción
    },
    buscar_en_documentos: async ({ query }) => {
      if (!query) return { error: "Falta indicar qué buscar." };
      if (!docsDb) return { error: notaIndice() };
      let pasajes = docs.buscarContenido(docsDb, query);
      // Si pregunta por un documento que existe pero no se pudo leer ni con OCR, otros textos que solo comparten
      // alguna palabra no son la respuesta: se quedan solo los de archivos con ese mismo nombre.
      const ilegibles = docs.ilegiblesPorNombre(docsDb, query);
      if (ilegibles.length) pasajes = pasajes.filter((p) => docs.nombreCoincide(p.nombre, query));
      if (pasajes.length || ilegibles.length) return { query, pasajes, ilegibles, nota: notaIndice() };
      // Sin coincidencias en el texto: quizá preguntó por un archivo por su nombre, y puede no estar indexado (código, json...)
      const porNombre = docs.terminos(query).length ? docs.buscarNombre(docsDb, docs.terminos(query).join(" "), 3).filter((f) => f.tipo === "archivo") : [];
      if (porNombre.length) {
        const leido = await docs.leerDocumento(porNombre[0].ruta, query);
        if (leido.pasajes) return { query, pasajes: leido.pasajes, nota: notaIndice() };
        return { error: leido.error };
      }
      return { query, pasajes: [], nota: notaIndice() };
    },
    leer_documento: async ({ path: p, consulta = "", soloCoincidencias = false }) => {
      if (!p) return { error: "Falta la ruta del archivo." };
      return docs.leerDocumento(p, consulta, { soloCoincidencias });
    },
    abrir_url: async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { error: "Solo URLs http/https" };
      await openExternal(url);
      return { ok: true, abierta: url };
    },
    reproducir_youtube: ({ consulta }) => musica.reproducir(consulta, { abrir: openExternal }),
    control_musica: ({ accion }) => musica.controlar(accion),
    buscar_google: ({ consulta }) => pantalla.buscarEnGoogle(consulta, { abrir: openExternal }),
    leer_pantalla: () => pantalla.leerActiva(),
    crear_recordatorio: ({ orden }) => recordatorios.crearDesdeTexto(orden),
    consultar_memoria: ({ consulta }) => ({ consulta, recuerdos: memoria.buscar(consulta, { max: 12, maxCaracteres: 2500 }) }),
    buscar_conversaciones: ({ consulta = "", cuando = "" }) => conversaciones.buscar({ consulta, cuando }),
    abrir_archivo: async ({ path: p }) => {
      if (!p || !fs.existsSync(p)) return { error: "No existe: " + p };
      // Mismas carpetas que para leer: nada del sistema, de AppData ni archivos de claves
      const permiso = docs.rutaPermitida(p, listaRaices);
      if (!permiso.ok) return { error: permiso.motivo };
      const real = permiso.real;
      const esCarpeta = fs.statSync(real).isDirectory();
      if (!esCarpeta && (NOMBRE_ENGANOSO.test(path.basename(p)) || !EXT_ABRIBLES.has(path.extname(real).toLowerCase()))) {
        return { error: "Por seguridad solo abro documentos, imágenes, audio, vídeo y carpetas. Ábrelo tú: " + real };
      }
      const err = await openPath(real);
      return err ? { error: err } : { ok: true, abierto: real };
    },
    fecha_hora: async () => ({ ahora: new Date().toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short" }) }),
  };

  const schema = [
    { name: "buscar_web", description: "Busca en internet información actual. Úsala para noticias, datos, precios, definiciones o cualquier cosa que no sepas con seguridad.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Consulta de búsqueda" } }, required: ["query"] } },
    { name: "leer_pagina", description: "Lee el texto de una página web (por ejemplo un resultado de buscar_web) para responder con detalle.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
    { name: "buscar_archivos", description: "Busca archivos o carpetas por nombre en las carpetas personales del usuario.",
      parameters: { type: "object", properties: { name: { type: "string", description: "Parte del nombre del archivo" } }, required: ["name"] } },
    { name: "buscar_en_documentos", description: "Busca dentro del contenido de los documentos del usuario (notas de Obsidian, PDF, Word, Excel, PowerPoint, texto) y devuelve fragmentos literales con su ubicación.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Palabras clave del contenido o del documento" } }, required: ["query"] } },
    { name: "leer_documento", description: "Lee un archivo concreto del usuario y devuelve sus fragmentos literales; si se indica consulta, los más relevantes.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Ruta completa" }, consulta: { type: "string", description: "Qué buscar en el archivo (opcional)" } }, required: ["path"] } },
    { name: "abrir_url", description: "Abre una página web en el navegador del usuario.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
    { name: "reproducir_youtube", description: "Busca una canción o un video en YouTube y lo reproduce en el navegador del usuario. Úsala cuando pida poner, escuchar o ver algo.",
      parameters: { type: "object", properties: { consulta: { type: "string", description: "Qué buscar, por ejemplo la canción y el artista" } }, required: ["consulta"] } },
    { name: "control_musica", description: "Controla lo que suena en el navegador: pausar, seguir o pasar a la siguiente canción.",
      parameters: { type: "object", properties: { accion: { type: "string", description: "pausar, seguir o siguiente" } }, required: ["accion"] } },
    { name: "buscar_google", description: "Abre una búsqueda de Google en el navegador del usuario y lee los resultados y el resumen de Gemini, si aparece. Úsala cuando pida buscar en Google o pregunte qué dice Gemini.",
      parameters: { type: "object", properties: { consulta: { type: "string", description: "Qué buscar" } }, required: ["consulta"] } },
    { name: "leer_pantalla", description: "Lee el texto de la ventana que el usuario tiene abierta. Úsala solo cuando pida que leas o resumas lo que tiene en pantalla.",
      parameters: { type: "object", properties: {} } },
    { name: "crear_recordatorio", description: "Avisa al usuario en voz alta más tarde. Úsala cuando pida que le recuerdes algo, una alarma o un temporizador.",
      parameters: { type: "object", properties: { orden: { type: "string", description: "Cuándo y qué, en español: «en 90 minutos sacar el pan», «mañana a las 9 llamar a Juan»" } }, required: ["orden"] } },
    { name: "consultar_memoria", description: "Busca en lo que el usuario pidió recordar y en sus notas de memoria por temas (trabajo, familia, gustos, proyectos…). Úsala cuando la pregunta dependa de su vida o sus preferencias y no tengas el dato.",
      parameters: { type: "object", properties: { consulta: { type: "string", description: "Qué buscar, en palabras clave" } }, required: ["consulta"] } },
    { name: "buscar_conversaciones", description: "Busca en lo que el usuario y tú hablasteis otros días (hasta 90 días atrás). Úsala cuando pregunte qué te dijo, qué le respondiste o de qué hablasteis. Sin consulta, trae lo último de ese periodo.",
      parameters: { type: "object", properties: { consulta: { type: "string", description: "De qué se habló, en palabras clave (opcional)" }, cuando: { type: "string", description: "Cuándo, en español: «ayer», «la semana pasada», «el martes», «hace 3 días» (opcional)" } }, required: [] } },
    { name: "abrir_archivo", description: "Abre un archivo o carpeta del usuario con su programa predeterminado (ruta completa).",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "fecha_hora", description: "Devuelve la fecha y hora actuales.", parameters: { type: "object", properties: {} } },
  ].map((f) => ({ type: "function", function: f }));

  async function run(name, args) {
    const fn = impl[name];
    if (!fn) return { error: `Herramienta desconocida: ${name}. Solo existen: ${Object.keys(impl).join(", ")}` };
    try { return await fn(args || {}); } catch (e) { return { error: e.message }; }
  }
  return { schema, run };
}

module.exports = { makeTools, webSearch, readPage, searchFiles, destinoPublico, esIpPrivada };
