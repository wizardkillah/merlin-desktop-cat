// Documentos del usuario: qué se puede leer, cómo extraer el texto y cómo buscarlo.
// Todo es local. El índice es una base SQLite con búsqueda de texto completo (FTS5, ya incluida en Node/Electron).
const fs = require("fs");
const path = require("path");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");
const { execFile } = require("child_process");
const { unzipSync, strFromU8 } = require("fflate");

// ---------- Qué se indexa y qué nunca se toca ----------
const EXT_INDEXABLES = new Set([".md", ".txt", ".csv", ".tsv", ".html", ".htm", ".pdf", ".docx", ".xlsx", ".pptx"]);
const EXT_SOLO_LECTURA = new Set([".json", ".log", ".xml", ".yml", ".yaml", ".ini", ".toml", ".sql", ".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".css", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs", ".php", ".rb", ".sh", ".ps1", ".bat", ".base", ".canvas", ".service", ".timer", ".conf"]);
const EXT_TEXTO = new Set([".md", ".txt", ".csv", ".tsv", ...EXT_SOLO_LECTURA]);
const DIRS_EXCLUIDOS = new Set(["node_modules", "appdata", "$recycle.bin", "system volume information", "__pycache__", "venv", "env", "dist", "build", "target", "bower_components", "site-packages"]);
const DIRS_SISTEMA = new Set(["windows", "program files", "program files (x86)", "programdata", "perflogs", "recovery", "users", "documents and settings", "msocache", "intel", "amd", "nvidia", "drivers", "onedrivetemp", "xboxgames", "inetpub", "swsetup", "system.sav", "hkey_current_user", "riot games"]);
// Claves, contraseñas y credenciales: nunca se indexan ni se leen, aunque el modelo lo pida
const SENSIBLE = /^(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|known_hosts|credentials?(\..*)?|secrets?(\..*)?|.*(password|contrase[nñ]a|clave[s]?[-_ ]?(api|privada)|api[-_ ]?keys?)[^\\/]*|(.*[-_ .])?tokens?([-_ .].*)?|.*\.(pem|key|pfx|p12|kdbx|kdb|ppk|asc|gpg|keystore|jks|wallet))$/i;

const LIMITE_ARCHIVO = { ".pdf": 60e6, ".xlsx": 40e6, ".docx": 40e6, ".pptx": 80e6, otro: 8e6 };
const MAX_TEXTO = 3e6;            // caracteres por documento
const MAX_FRAGMENTOS = 90000;     // id de fragmento = id de documento * 100000 + número
const TAM_FRAGMENTO = 650;
const VERSION_LECTOR = "4";       // súbela al mejorar la extracción: reintenta lo que quedó vacío o con error

const sinAcentos = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Se recalcula como mucho una vez por minuto: recorrer todas las unidades en cada lectura es lento,
// y una unidad de red desconectada lo bloquearía cada vez
let raicesGuardadas = null, raicesHasta = 0;
function raices() {
  if (raicesGuardadas && Date.now() < raicesHasta) return raicesGuardadas;
  raicesGuardadas = calcularRaices();
  raicesHasta = Date.now() + 60000;
  return raicesGuardadas;
}
function calcularRaices() {
  const lista = [os.homedir()];
  const unidades = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => l + ":\\").filter((u) => { try { return fs.statSync(u).isDirectory(); } catch { return false; } });
  for (const u of unidades) {
    let hijos = [];
    try { hijos = fs.readdirSync(u, { withFileTypes: true }); } catch { continue; }
    for (const h of hijos) {
      const n = h.name.toLowerCase();
      if (h.isDirectory() && !n.startsWith("$") && !n.startsWith(".") && !DIRS_SISTEMA.has(n) && !DIRS_EXCLUIDOS.has(n)) lista.push(path.join(u, h.name));
    }
  }
  return lista;
}
const dirExcluido = (nombre) => nombre.startsWith(".") || DIRS_EXCLUIDOS.has(nombre.toLowerCase());
const esSensible = (nombre) => SENSIBLE.test(nombre);

// Una ruta se puede leer si está dentro de las carpetas personales y ninguna parte está excluida
function rutaPermitida(ruta, listaRaices = raices()) {
  let real;
  try { real = fs.realpathSync(path.resolve(ruta)); } catch { return { ok: false, motivo: "No existe: " + ruta }; }
  const raiz = listaRaices.find((r) => real.toLowerCase() === r.toLowerCase() || real.toLowerCase().startsWith(r.toLowerCase() + path.sep));
  if (!raiz) return { ok: false, motivo: "Esa ruta queda fuera de tus carpetas personales: no la leo." };
  const partes = real.slice(raiz.length).split(path.sep).filter(Boolean);
  if (partes.slice(0, -1).some(dirExcluido) || (partes.length && dirExcluido(partes.at(-1)) && !fs.statSync(real).isFile())) return { ok: false, motivo: "Esa carpeta está excluida (sistema o datos internos)." };
  if (esSensible(path.basename(real))) return { ok: false, motivo: "Por seguridad no leo archivos de claves o contraseñas." };
  return { ok: true, real };
}

// ---------- Extracción de texto ----------
const decodificarXml = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");

function leerTexto(ruta) {
  const b = fs.readFileSync(ruta);
  if (b[0] === 0xff && b[1] === 0xfe) return b.toString("utf16le").slice(1);
  const t = b.toString("utf8").replace(/^\uFEFF/, "");
  const raros = (t.slice(0, 20000).match(/\uFFFD/g) || []).length;
  return raros > 5 ? b.toString("latin1") : t;
}
function porLineas(texto) {
  return texto.split(/\r?\n/).map((l, i) => ({ loc: `línea ${i + 1}`, texto: l }));
}
function html(ruta) {
  const t = leerTexto(ruta)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  return decodificarXml(t).split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).map((l) => ({ loc: "", texto: l }));
}
function zip(ruta, filtro) {
  return unzipSync(fs.readFileSync(ruta), { filter: (f) => filtro(f.name) });
}
function docx(ruta) {
  const archivos = zip(ruta, (n) => n === "word/document.xml");
  const xml = strFromU8(archivos["word/document.xml"] || new Uint8Array());
  const salida = [];
  let n = 0;
  for (const p of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const t = [...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    if (t.trim()) salida.push({ loc: `párrafo ${++n}`, texto: decodificarXml(t) });
  }
  return salida;
}
function pptx(ruta) {
  const archivos = zip(ruta, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const orden = (k) => +k.match(/(\d+)\.xml$/)[1];
  return Object.keys(archivos).sort((a, b) => orden(a) - orden(b)).map((k) => ({
    loc: `diapositiva ${orden(k)}`,
    texto: [...strFromU8(archivos[k]).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodificarXml(m[1])).join(" "),
  })).filter((s) => s.texto.trim());
}
function xlsx(ruta) {
  const archivos = zip(ruta, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  // Algunas herramientas escriben <x:sheet> o <ns0:row>: sin prefijo todos los archivos se leen igual
  const texto = (k) => (archivos[k] ? strFromU8(archivos[k]).replace(/<(\/?)[A-Za-z_][\w.-]*:/g, "<$1") : "");
  const compartidas = [...texto("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decodificarXml([...m[1].matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  const destinos = Object.fromEntries([...texto("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1]]));
  const salida = [];
  for (const h of texto("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = decodificarXml(h[0].match(/name="([^"]+)"/)?.[1] || "hoja");
    const destino = destinos[h[0].match(/r:id="([^"]+)"/)?.[1]] || "";
    const xml = texto(destino.startsWith("/") ? destino.slice(1) : "xl/" + destino);
    let encabezado = "", bloque = [], inicio = 0, filas = 0;
    const volcar = () => {
      if (bloque.length) salida.push({ loc: `hoja «${nombre}», fila ${inicio}`, texto: (encabezado && bloque[0] !== encabezado ? encabezado + "\n" : "") + bloque.join("\n") });
      bloque = [];
    };
    for (const f of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      if (++filas > 20000) break;
      const celdas = [...f[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        if (!c[2]) return "";
        const v = c[2].match(/<v>([^<]*)<\/v>/)?.[1];
        if (/t="s"/.test(c[1])) return compartidas[+v] ?? "";
        if (/t="inlineStr"/.test(c[1])) return decodificarXml([...c[2].matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
        return v != null ? decodificarXml(v) : "";
      }).filter((x) => String(x).trim());
      if (!celdas.length) continue;
      const linea = celdas.join(" | ");
      if (!encabezado) encabezado = linea;
      if (!bloque.length) inicio = +(f[1].match(/\br="(\d+)"/)?.[1] || filas);
      bloque.push(linea);
      if (bloque.join("\n").length > TAM_FRAGMENTO - encabezado.length) volcar();
    }
    volcar();
  }
  return salida;
}
async function pdf(ruta) {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(ruta)), { isEvalSupported: false, verbosity: 0 });
  let paginas, total;
  try {
    const { text } = await extractText(doc, { mergePages: false });
    total = text.length;
    paginas = text.map((t, i) => ({ loc: `pág. ${i + 1}`, texto: t.replace(/[ \t]+/g, " ").trim() })).filter((s) => s.texto);
  } finally { await doc.destroy?.(); }
  // Casi sin texto (a veces solo un sello o un número de página): es un escaneo
  const caracteres = paginas.reduce((n, p) => n + p.texto.length, 0);
  if (caracteres >= 20 * Math.max(1, total)) return paginas;
  const leidas = await ocrPdf(ruta);
  return leidas.reduce((n, p) => n + p.texto.length, 0) > caracteres ? leidas : paginas;
}

// OCR con el motor de Windows: no instala nada y no sale del PC. Un fallo no impide seguir (queda como escaneo sin leer).
const SCRIPT_OCR = path.join(__dirname, "..", "scripts", "ocr-pdf.ps1");
const POWERSHELL = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
function ocrPdf(ruta) {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((listo) => {
    execFile(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_OCR, "-Ruta", ruta],
      { windowsHide: true, encoding: "utf8", maxBuffer: 2e8, timeout: 10 * 60 * 1000 }, (error, salida, avisos) => {
        if (error) { console.error("[ocr]", path.basename(ruta), String(avisos || error.message).slice(0, 300)); return listo([]); }
        try {
          // «EI» por «El» es el error más común del OCR en español; sin corregirlo, tampoco se encuentra al buscar
          listo(JSON.parse(salida).paginas.map((p) => ({ loc: `pág. ${p.n}, OCR`, texto: p.texto.replace(/\bEI\b/g, "El").trim() })).filter((p) => p.texto));
        } catch (e) { console.error("[ocr]", path.basename(ruta), e.message); listo([]); }
      });
  });
}

// Devuelve [{loc, texto}]. Lanza un error si el archivo no se puede leer.
async function extraer(ruta) {
  const ext = path.extname(ruta).toLowerCase();
  const tam = fs.statSync(ruta).size;
  if (tam > (LIMITE_ARCHIVO[ext] || LIMITE_ARCHIVO.otro)) throw new Error(`demasiado grande (${Math.round(tam / 1e6)} MB)`);
  if (ext === ".pdf") return pdf(ruta);
  if (ext === ".docx") return docx(ruta);
  if (ext === ".xlsx") return xlsx(ruta);
  if (ext === ".pptx") return pptx(ruta);
  if (ext === ".html" || ext === ".htm") return html(ruta);
  if (EXT_TEXTO.has(ext)) return porLineas(leerTexto(ruta));
  throw new Error(`no sé leer archivos ${ext || "sin extensión"}`);
}

// Junta segmentos en fragmentos de tamaño citable y conserva dónde empieza cada uno
function trocear(segmentos) {
  const salida = [];
  let actual = null, total = 0;
  const cerrar = () => { if (actual?.texto.trim()) salida.push({ loc: actual.loc, texto: actual.texto.trim() }); actual = null; };
  for (const s of segmentos) {
    if (total > MAX_TEXTO || salida.length >= MAX_FRAGMENTOS) break;
    if (!s.texto.trim() && !actual) continue;
    total += s.texto.length;
    let t = s.texto;
    const mismoLugar = actual && !/^(pág|hoja|diapositiva)/.test(s.loc);
    if (!mismoLugar) cerrar();
    while (t.length > TAM_FRAGMENTO * 1.3) {
      // Segmento largo (una página o una línea enorme): se corta por frases
      let corte = t.lastIndexOf(". ", TAM_FRAGMENTO);
      if (corte < TAM_FRAGMENTO / 2) corte = t.lastIndexOf(" ", TAM_FRAGMENTO);
      if (corte < TAM_FRAGMENTO / 2) corte = TAM_FRAGMENTO;
      salida.push({ loc: actual?.loc || s.loc, texto: ((actual ? actual.texto + "\n" : "") + t.slice(0, corte + 1)).trim() });
      actual = null;
      t = t.slice(corte + 1);
    }
    if (!actual) actual = { loc: s.loc, texto: t };
    else actual.texto += "\n" + t;
    if (actual.texto.length >= TAM_FRAGMENTO) cerrar();
  }
  cerrar();
  return salida;
}

// ---------- Base de datos ----------
function abrirBD(ruta) {
  const db = new DatabaseSync(ruta);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, ruta TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, nombre_norm TEXT NOT NULL, ext TEXT, tipo TEXT, tam INTEGER, mtime INTEGER, estado TEXT, detalle TEXT);
    CREATE INDEX IF NOT EXISTS docs_estado ON docs(estado);
    CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(nombre, ruta, loc UNINDEXED, texto, doc_id UNINDEXED, tokenize="unicode61 remove_diacritics 2");`);
  return db;
}

// ---------- Consulta ----------
// Palabras que describen la petición pero no el contenido buscado
const VACIAS = new Set(sinAcentos(`no a al algo algun alguna algunas alguno algunos ante aqui asi aun bajo busca buscame buscar cita citame como con contenido contiene contra cual cuales cuando cuanto cuanta cuantos cuantas de del desde dice dicen dime documento documentos donde el ella ellos en encuentra encuentrame entre es esa ese eso esta estan este esto fichero ficheros hay habla hablan la las le lee leeme les lo los mas me mi mis muestra muestrame nos nota notas o oye para pero pone por porfa puedes que quien quiero resume resumeme segun ser si sobre son su sus te tengo tiene tienen trata tu un una uno unos unas ver y ya yo archivo archivos usa usan usar buscalo buscala buscalos buscalas encuentralo encuentrala mira revisa dame carpeta carpetas boveda obsidian favor`).split(/\s+/));
function terminos(consulta) {
  const vistos = new Set();
  // «Oye Merlín, ...» es dirigirse a él; en otra posición, «Merlín» puede ser el tema de la pregunta
  const sinVocativo = sinAcentos(consulta).replace(/^\s*(oye |hola |hey )?merlin\b[,:]?/, " ");
  return (sinVocativo.match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 1 && !VACIAS.has(t) && !vistos.has(t) && vistos.add(t));
}
// Raíz sencilla para el español: contratos -> contrat*, arriendo -> arriend*
const raiz = (t) => (/^\d/.test(t) || t.length < 5 ? t : t.replace(/(es|s)$/, "").replace(/[aeo]$/, ""));
// Sinónimos habituales en estos documentos. La búsqueda es por palabras: sin esto, «plazo» no encuentra «indefinido».
const GRUPOS = [
  ["plazo", "duracion", "vigencia", "indefinido", "vencimiento"],
  ["arriendo", "arrendamiento", "arrendatario", "arrendador"],
  ["precio", "costo", "valor", "monto"],
  ["sueldo", "salario", "remuneracion"],
  ["cabra", "cabras", "caprino", "caprinos"],
];
// Dentro de un grupo se usa la palabra entera: la raíz «plaz» de plazo también coincidiría con «plaza»
const variantes = (t) => {
  const grupo = GRUPOS.find((g) => g.includes(t) || g.some((x) => raiz(x) === raiz(t)));
  return grupo ? [...new Set(grupo.map((x) => x.replace(/s$/, "")))] : [raiz(t)];
};
const aFts = (ts, op) => ts.map((t) => `(${variantes(t).map((v) => `"${v}"*`).join(" OR ")})`).join(` ${op} `);

// Recorte literal alrededor de la primera coincidencia; no altera el texto, solo lo acorta por los bordes
function recorte(texto, ts, max = 420) {
  if (texto.length <= max) return texto;
  const plano = sinAcentos(texto);
  // sinAcentos conserva la longitud salvo ligaduras raras; se usa solo para situar el corte.
  // Se elige la ventana que reúne más palabras distintas de la consulta, no la primera coincidencia.
  const apariciones = [];
  ts.forEach((t, n) => { for (const r of variantes(t)) for (let i = plano.indexOf(r); i >= 0; i = plano.indexOf(r, i + r.length)) apariciones.push({ i, n }); });
  apariciones.sort((a, b) => a.i - b.i);
  let pos = -1, mejor = 0;
  for (const a of apariciones) {
    const distintas = new Set(apariciones.filter((b) => b.i >= a.i && b.i < a.i + max * 0.75).map((b) => b.n)).size;
    if (distintas > mejor) { mejor = distintas; pos = a.i; }
  }
  let ini = Math.max(0, (pos < 0 ? 0 : pos) - Math.floor(max / 5));
  if (ini > 0) { const esp = texto.indexOf(" ", ini); if (esp > 0 && esp - ini < 40) ini = esp + 1; }
  let fin = Math.min(texto.length, ini + max);
  if (fin < texto.length) { const esp = texto.lastIndexOf(" ", fin); if (esp > ini + max / 2) fin = esp; }
  return (ini > 0 ? "… " : "") + texto.slice(ini, fin).trim() + (fin < texto.length ? " …" : "");
}

function buscarContenido(db, consulta, { maxDocs = 3, porDoc = 2 } = {}) {
  const ts = terminos(consulta);
  if (!ts.length) return [];
  const sql = db.prepare(`SELECT rowid AS id, doc_id, nombre, ruta, loc, texto, bm25(fts, 7, 2.5, 0, 1, 0) AS rango FROM fts WHERE fts MATCH ? ORDER BY rango LIMIT 250`);
  let filas = [];
  const ejecutar = (q) => { try { return sql.all(q); } catch { return []; } };
  filas = ejecutar(aFts(ts, "AND"));
  // Si ningún fragmento tiene todas las palabras, se aceptan los que tengan alguna y se premian los que tengan más
  if (filas.length < 3 && ts.length > 1) {
    const yaVistos = new Set(filas.map((f) => f.id));
    const extra = ejecutar(aFts(ts, "OR")).filter((f) => !yaVistos.has(f.id));
    const cubre = (f) => { const p = sinAcentos(`${f.nombre} ${f.ruta} ${f.texto}`); return ts.filter((t) => variantes(t).some((v) => p.includes(v))).length; };
    extra.sort((a, b) => cubre(b) - cubre(a) || a.rango - b.rango);
    // Una sola palabra en común no basta: mejor decir que no está que citar algo sin relación
    const minimo = Math.max(2, Math.ceil(ts.length * 0.6));
    // Excepción con dos palabras: si una es muy específica (un nombre, un código), basta con ella
    const docsCon = db.prepare("SELECT COUNT(DISTINCT doc_id) n FROM fts WHERE fts MATCH ?");
    const especificas = ts.length === 2 ? ts.filter((t) => docsCon.get(aFts([t], "AND")).n <= 5) : [];
    const tieneEspecifica = (f) => { const p = sinAcentos(`${f.nombre} ${f.texto}`); return especificas.some((t) => p.includes(raiz(t))); };
    filas = filas.concat(extra.filter((f) => cubre(f) >= minimo || tieneEspecifica(f)));
  }
  // Si la pregunta nombra un documento, manda ese documento antes que otros que solo hablan de él.
  // Sus fragmentos se ordenan por las palabras que no forman parte del nombre: son lo que se pregunta.
  const delNombre = (f) => ts.length > 1 && nombreCoincide(f.nombre, consulta);
  const preguntado = (f) => {
    const nombre = sinAcentos(f.nombre), resto = ts.filter((t) => !nombre.includes(raiz(t))), p = sinAcentos(f.texto);
    return resto.filter((t) => variantes(t).some((v) => p.includes(v))).length;
  };
  let nombrados = filas.filter(delNombre).sort((a, b) => preguntado(b) - preguntado(a) || a.rango - b.rango);
  if (nombrados.length && preguntado(nombrados[0]) > 0) nombrados = nombrados.filter((f) => preguntado(f) > 0); // las otras páginas no responden a esto
  filas = [...nombrados, ...filas.filter((f) => !delNombre(f))];
  const cuenta = new Map(), salida = [], textos = new Set();
  for (const f of filas) {
    const texto = recorte(f.texto, ts);
    // Otra copia del mismo archivo (respaldos): mismo nombre y lugar, o mismo texto salvo los espacios
    const huella = sinAcentos(texto).replace(/\s+/g, "");
    if (textos.has(huella) || textos.has(f.nombre + "|" + f.loc)) continue;
    const n = cuenta.get(f.doc_id) || 0;
    if (n >= porDoc || (n === 0 && cuenta.size >= maxDocs)) continue;
    textos.add(huella); textos.add(f.nombre + "|" + f.loc);
    cuenta.set(f.doc_id, n + 1);
    salida.push({ ruta: f.ruta, nombre: f.nombre, loc: f.loc, texto, ...(delNombre(f) ? { nombrado: true } : {}) });
  }
  return salida;
}

// Archivos cuyo nombre encaja con la consulta pero de los que no se pudo sacar texto (escaneos).
// Sirve para avisar en lugar de callar: el documento existe, aunque no se pueda citar.
function ilegiblesPorNombre(db, consulta, max = 3) {
  const ts = terminos(consulta);
  if (!ts.length) return [];
  const minimo = Math.min(2, ts.length);
  return db.prepare("SELECT ruta, nombre, nombre_norm FROM docs WHERE estado = 'sin-texto' AND ext = '.pdf'").all()
    .filter((d) => ts.filter((t) => d.nombre_norm.includes(raiz(t))).length >= minimo)
    .slice(0, max).map((d) => ({ ruta: d.ruta, nombre: d.nombre }));
}
function nombreCoincide(nombre, consulta) {
  const ts = terminos(consulta), n = sinAcentos(nombre);
  return ts.filter((t) => n.includes(raiz(t))).length >= Math.min(2, ts.length);
}

function buscarNombre(db, nombre, max = 15) {
  const ts = (sinAcentos(nombre).match(/[\p{L}\p{N}.]+/gu) || []).filter(Boolean);
  if (!ts.length) return [];
  const cond = ts.map(() => "(nombre_norm LIKE ? ESCAPE '\\')").join(" AND ");
  const args = ts.map((t) => `%${t.replace(/[%_\\]/g, "\\$&")}%`);
  return db.prepare(`SELECT ruta, nombre, tipo, estado FROM docs WHERE ${cond} ORDER BY (estado='ok') DESC, LENGTH(nombre) LIMIT ?`).all(...args, max);
}

// Pasajes de un archivo concreto. Sirve también para archivos que no están en el índice.
async function leerDocumento(ruta, consulta = "", { maxPasajes = 3, listaRaices, soloCoincidencias = false } = {}) {
  const permiso = rutaPermitida(ruta, listaRaices);
  if (!permiso.ok) return { error: permiso.motivo };
  const real = permiso.real;
  if (fs.statSync(real).isDirectory()) {
    const hijos = fs.readdirSync(real, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).slice(0, 40);
    return { carpeta: real, contenido: hijos.map((e) => (e.isDirectory() ? "[carpeta] " : "") + e.name) };
  }
  let fragmentos;
  try { fragmentos = trocear(await extraer(real)); }
  catch (e) { return { error: `No pude leer ${path.basename(real)}: ${e.message}` }; }
  const nombre = path.basename(real);
  if (!fragmentos.length) return { error: `${nombre} no contiene texto legible; si es un escaneo, ni el OCR pudo leerlo.` };
  const ts = terminos(consulta);
  let elegidos = fragmentos;
  if (ts.length) {
    const puntos = (f) => { const p = sinAcentos(f.texto); return ts.reduce((n, t) => n + (variantes(t).some((v) => p.includes(v)) ? 1 : 0), 0); };
    const conCoincidencia = fragmentos.map((f, i) => ({ f, i, p: puntos(f) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p || a.i - b.i);
    if (conCoincidencia.length) elegidos = conCoincidencia.map((x) => x.f);
    else if (soloCoincidencias) elegidos = [];
  } else if (soloCoincidencias) elegidos = [];
  if (soloCoincidencias && !elegidos.length) return { ruta: real, nombre, total: fragmentos.length, pasajes: [] };
  return { ruta: real, nombre, total: fragmentos.length, pasajes: elegidos.slice(0, maxPasajes).map((f) => ({ ruta: real, nombre, loc: f.loc, texto: recorte(f.texto, ts, 520) })) };
}

function estadoIndice(db) {
  const c = (q) => db.prepare(q).get().n;
  const get = (k) => db.prepare("SELECT valor FROM meta WHERE clave = ?").get(k)?.valor;
  return {
    total: c("SELECT COUNT(*) n FROM docs"),
    indexados: c("SELECT COUNT(*) n FROM docs WHERE estado='ok'"),
    pendientes: c("SELECT COUNT(*) n FROM docs WHERE estado='pendiente'"),
    sinTexto: c("SELECT COUNT(*) n FROM docs WHERE estado='sin-texto'"),
    errores: c("SELECT COUNT(*) n FROM docs WHERE estado='error'"),
    ultimaPasada: get("ultima_pasada") || null,
  };
}

module.exports = {
  EXT_INDEXABLES, MAX_FRAGMENTOS, VERSION_LECTOR, raices, dirExcluido, esSensible, rutaPermitida, sinAcentos,
  extraer, trocear, abrirBD, terminos, buscarContenido, ilegiblesPorNombre, nombreCoincide, buscarNombre, leerDocumento, estadoIndice,
};
