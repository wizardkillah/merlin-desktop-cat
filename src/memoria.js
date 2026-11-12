// Memoria por temas: notas de Obsidian en «Gatito Brujo/Memoria», una por tema (Trabajo.md, Familia.md…).
// Las escriben el usuario y Merlín («anota en trabajo que…»). Antes de cada respuesta se buscan los recuerdos que
// vienen al caso, también los viejos de Personalidad/Aprendizaje.md que ya no caben en las instrucciones.
// Así puede recordar miles de cosas sin pagarlas todas en cada pregunta.
//
// Privacidad: esta carpeta la elige el usuario para que Merlín la use al conversar, así que SÍ puede llegar a Claude.
// El resto de sus documentos sigue sin salir del PC. Las líneas que parecen contraseñas o números personales no se usan.
const fs = require("fs");
const path = require("path");
const personalidad = require("./personalidad");

const MAX_ENTRADA = 300, MAX_RECUERDOS = 6, MAX_CARACTERES = 1200;
const LEEME = "_Cómo funciona.md";
const TEXTO_LEEME = `---
tags: [gatito-brujo, memoria]
---
# Memoria de Merlín

Cada nota de esta carpeta es un tema (Trabajo, Familia, Salud, Proyectos…). Antes de responder, Merlín busca aquí lo que viene al caso.

- Escribe cada recuerdo como una línea con guion. También sirven párrafos normales.
- Para que Merlín anote él mismo: «anota en trabajo que mi jefa se llama Ana», «recuerda sobre el auto que le toca revisión en marzo».
- Para borrar: «olvida lo de …», o borra la línea aquí.
- Las notas cuyo nombre empieza por «_» no se leen.

**Ojo**: lo que pongas aquí puede enviarse a Claude cuando venga al caso. No pongas contraseñas ni números de tarjeta o documentos: esas líneas se descartan.
`;

// Por defecto, junto a la carpeta Personalidad (en la bóveda, «Gatito Brujo/Memoria»). Se calcula al usarla:
// así las pruebas que mueven Personalidad a una carpeta temporal tampoco tocan la memoria real.
let elegida = process.env.MERLIN_MEMORIA || "";
const configurar = (dir) => { elegida = dir; cache.clear(); };
const rutaCarpeta = () => elegida
  || (process.env.MERLIN_PERSONALIDAD ? path.join(process.env.MERLIN_PERSONALIDAD, "Memoria") : path.join(path.dirname(personalidad.carpetaPersonalidad()), "Memoria"));

function asegurar() {
  const carpeta = rutaCarpeta();
  fs.mkdirSync(carpeta, { recursive: true });
  const leeme = path.join(carpeta, LEEME);
  if (!fs.existsSync(leeme)) fs.writeFileSync(leeme, TEXTO_LEEME);
}

// ---------- Lectura de las notas ----------
const sinAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sinFecha = (l) => l.replace(/^\d{4}-\d{2}-\d{2}:\s*/, "");

// Recuerdos de una nota: cada viñeta y cada párrafo, con el título de la sección como contexto
function trocearNota(texto) {
  const salida = [];
  let seccion = "", parrafo = [];
  const cerrar = () => { if (parrafo.length) salida.push({ seccion, texto: parrafo.join(" ").trim(), vineta: false }); parrafo = []; };
  const sinFrontmatter = texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  for (const linea of sinFrontmatter.split(/\r?\n/)) {
    const titulo = linea.match(/^#{1,6}\s+(.+)$/);
    const vineta = linea.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (titulo) { cerrar(); seccion = titulo[1].trim(); }
    else if (vineta) { cerrar(); salida.push({ seccion, texto: sinFecha(vineta[1].trim()), vineta: true }); }
    else if (!linea.trim()) cerrar();
    else parrafo.push(linea.trim());
  }
  cerrar();
  return salida.filter((r) => r.texto.length >= 3 && !personalidad.esSecreto(r.texto)).map((r) => ({ ...r, texto: r.texto.slice(0, 500) }));
}

// Se relee una nota solo si cambió
const cache = new Map();
function recuerdosDe(ruta, tema, { soloVinetas = false } = {}) {
  let mtime;
  try { mtime = fs.statSync(ruta).mtimeMs; } catch { return []; }
  const previo = cache.get(ruta);
  if (previo && previo.mtime === mtime) return previo.items;
  let texto = "";
  try { texto = fs.readFileSync(ruta, "utf8"); } catch { return []; }
  const items = trocearNota(texto).filter((r) => !soloVinetas || r.vineta).map((r, i) => ({ tema, seccion: r.seccion, texto: r.texto, orden: i, norma: sinAcentos(`${tema} ${r.seccion} ${r.texto}`) }));
  cache.set(ruta, { mtime, items });
  return items;
}

function notas() {
  const carpeta = rutaCarpeta();
  let nombres = [];
  try { nombres = fs.readdirSync(carpeta).filter((n) => n.toLowerCase().endsWith(".md") && !n.startsWith("_") && !n.startsWith(".")); } catch {}
  return nombres.map((n) => ({ ruta: path.join(carpeta, n), tema: n.slice(0, -3) }));
}

// Todo lo recordado: las notas de temas y el grimorio de «recuerda que…»
function todos() {
  const lista = notas().flatMap((n) => recuerdosDe(n.ruta, n.tema));
  // Del grimorio solo cuentan las viñetas: los párrafos son la explicación de la nota
  lista.push(...recuerdosDe(personalidad.rutaAprendizaje(), "Sobre el usuario", { soloVinetas: true }));
  return lista;
}

// ---------- Búsqueda ----------
const VACIAS = new Set(sinAcentos(`a al algo alguna alguno ante como con cual cuales cuando cuanto cuanta cuantos cuantas de del donde el ella ellos en entre es esa ese eso esta estan este esto fue ha hay la las le les lo los mas me mi mis muy no nos o oye para pero por porque que quien se ser si sin sobre son su sus te tengo tiene tu tus un una uno unos unas y ya yo merlin dime dame sabes recuerdas puedes quiero hola hey favor gracias bueno vale ok`).split(/\s+/));
const raiz = (t) => (/^\d/.test(t) || t.length < 5 ? t : t.replace(/(es|s)$/, "").replace(/[aeo]$/, ""));
function terminos(texto) {
  const vistos = new Set();
  return (sinAcentos(texto).match(/[\p{L}\p{N}]+/gu) || []).filter((t) => (t.length > 2 || /^\d{2}$/.test(t)) && !VACIAS.has(t)).map(raiz).filter((t) => !vistos.has(t) && vistos.add(t));
}
// Una palabra del recuerdo coincide si empieza por la raíz del término: «hermanas» encuentra «hermano»
const coincide = (norma, t) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(norma);

// Los recuerdos que más se parecen a la consulta. Devuelve [{ tema, seccion, texto }].
// Pesa más una palabra rara («Pirata», «jazz») que una común («llama», «número»): así una pregunta hablada,
// con verbos de relleno, encuentra lo suyo, y lo que solo comparte una palabra común no se cuela.
// Ordena por parecido con la consulta cualquier lista de elementos con { norma, orden }. Sirve también para
// buscar en las conversaciones pasadas (conversaciones.js). Devuelve los elementos que pasan el corte, ordenados.
function ordenarPorParecido(lista, consulta) {
  const ts = terminos(consulta || "");
  if (!ts.length) return [];
  const df = new Map(ts.map((t) => [t, lista.filter((r) => coincide(r.norma, t)).length]));
  const peso = (t) => Math.log(1 + lista.length / Math.max(1, df.get(t)));
  const RARA = 3, minimo = ts.length <= 2 ? 1 : 2;
  const candidatos = lista
    .map((r) => { const hechos = ts.filter((t) => coincide(r.norma, t)); return { r, n: hechos.length, rara: hechos.some((t) => df.get(t) <= RARA && t.length >= 4), puntos: hechos.reduce((s, t) => s + peso(t), 0) }; })
    .filter((x) => x.n >= minimo || x.rara);
  const mejor = Math.max(0, ...candidatos.map((x) => x.puntos));
  return candidatos.filter((x) => x.puntos >= mejor * 0.5).sort((a, b) => b.puntos - a.puntos || b.r.orden - a.r.orden).map((x) => x.r);
}

function buscar(consulta, { max = MAX_RECUERDOS, maxCaracteres = MAX_CARACTERES, excluir = "" } = {}) {
  const fuera = sinAcentos(excluir);
  const puntuados = ordenarPorParecido(todos(), consulta).filter((r) => !(fuera && fuera.includes(sinAcentos(r.texto))));
  const salida = [], vistos = new Set();
  let total = 0;
  for (const r of puntuados) {
    const clave = sinAcentos(r.texto);
    if (vistos.has(clave)) continue;
    if (salida.length >= max || total + r.texto.length > maxCaracteres) break;
    vistos.add(clave); total += r.texto.length;
    salida.push({ tema: r.tema, seccion: r.seccion, texto: r.texto });
  }
  return salida;
}

// Texto para el modelo: cada recuerdo con su tema
const formatear = (recuerdos) => recuerdos.map((r) => `- [${r.tema}${r.seccion && r.seccion !== r.tema ? " › " + r.seccion : ""}] ${r.texto}`).join("\n");

// ---------- Escritura ----------
// «trabajo», «el auto», «mi familia» → «Trabajo», «Auto», «Familia»
function nombreTema(tema) {
  const t = String(tema || "").replace(/^(?:el|la|los|las|mi|mis|tu|tus)\s+/i, "").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!t) return "";
  // Si ya existe una nota con ese nombre (sin importar mayúsculas ni acentos), se usa esa
  const existente = notas().find((n) => sinAcentos(n.tema) === sinAcentos(t));
  return existente ? existente.tema : t[0].toUpperCase() + t.slice(1);
}

function guardar(tema, dato) {
  const nombre = nombreTema(tema);
  const limpio = String(dato || "").replace(/[<>\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ENTRADA);
  if (!nombre || limpio.length < 3) return { error: "vacio" };
  if (personalidad.esSecreto(limpio)) return { error: "secreto" };
  asegurar();
  const ruta = path.join(rutaCarpeta(), nombre + ".md");
  const previo = fs.existsSync(ruta) ? fs.readFileSync(ruta, "utf8") : `---\ntags: [gatito-brujo, memoria]\n---\n# ${nombre}\n\n`;
  const norma = (s) => sinAcentos(s).replace(/[^\p{L}\p{N}]/gu, "");
  if (trocearNota(previo).some((r) => norma(r.texto) === norma(limpio))) return { ok: true, repetido: true, tema: nombre, dato: limpio };
  const fecha = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(ruta, `${previo}${previo.endsWith("\n") ? "" : "\n"}- ${fecha}: ${limpio}\n`);
  return { ok: true, tema: nombre, dato: limpio };
}

// Borra las viñetas que contienen todas las palabras del tema, en todas las notas de la carpeta
function olvidar(tema) {
  const claves = sinAcentos(tema || "").match(/[\p{L}\p{N}]{3,}/gu) || [];
  if (!claves.length) return { borrados: [] };
  const borrados = [];
  for (const n of notas()) {
    let texto;
    try { texto = fs.readFileSync(n.ruta, "utf8"); } catch { continue; }
    const lineas = texto.split(/\r?\n/);
    const quedan = lineas.filter((l) => {
      const v = l.match(/^\s*[-*+]\s+(.+)$/)?.[1];
      if (!v || !claves.every((c) => sinAcentos(v).includes(c))) return true;
      borrados.push(sinFecha(v)); return false;
    });
    if (quedan.length !== lineas.length) fs.writeFileSync(n.ruta, quedan.join("\n"));
  }
  return { borrados };
}

const temas = () => notas().map((n) => n.tema);

module.exports = { configurar, rutaCarpeta, asegurar, buscar, ordenarPorParecido, sinAcentos, formatear, guardar, olvidar, temas, terminos, trocearNota, nombreTema };
