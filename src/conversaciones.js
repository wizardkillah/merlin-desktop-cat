// Buscar en conversaciones pasadas: «¿qué te dije la semana pasada del viaje?», «¿de qué hablamos ayer?».
// Idea tomada de la búsqueda de sesiones de Hermes Agent y hecha aquí, sobre el registro que ya existe
// (%APPDATA%\gatito-brujo\aprendizaje.jsonl, 90 días como máximo).
//
// Privacidad: de los turnos privados (documentos, pantalla, secretos) el registro no guarda el texto, así que
// nunca aparecen aquí. Lo demás ya era conversación normal y puede llegar a Claude como el historial.
const fs = require("fs");
const aprendizaje = require("./aprendizaje");
const { ordenarPorParecido, sinAcentos, terminos } = require("./memoria");

const MAX_TURNOS = 8, MAX_CARACTERES = 2500, MAX_PREGUNTA = 200, MAX_RESPUESTA = 300;
const DIA = 24 * 3600 * 1000;

// ---------- Leer el registro (se relee solo si cambió) ----------
let cache = { ruta: null, mtime: 0, tam: 0, turnos: [] };
function turnos(ruta = aprendizaje.rutaRegistro()) {
  if (!ruta) return [];
  let st;
  try { st = fs.statSync(ruta); } catch { return []; }
  if (cache.ruta === ruta && cache.mtime === st.mtimeMs && cache.tam === st.size) return cache.turnos;
  const lista = [];
  let texto = "";
  try { texto = fs.readFileSync(ruta, "utf8"); } catch { return []; }
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea) continue;
    let r;
    try { r = JSON.parse(linea); } catch { continue; }
    if (r.tipo !== "turno" || r.privado || !r.q || !r.r || r.via === "error") continue;
    lista.push({ t: r.t, q: r.q, r: r.r, orden: r.t, norma: sinAcentos(`${r.q} ${r.r}`) });
  }
  cache = { ruta, mtime: st.mtimeMs, tam: st.size, turnos: lista };
  return lista;
}

// ---------- Cuándo ----------
const NUMEROS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30 };
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const masDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const lunesDe = (d) => masDias(inicioDia(d), -((d.getDay() + 6) % 7));

// Lee una expresión de tiempo en español. Devuelve { desde, hasta, texto } (milisegundos) o null.
function periodo(texto, ahora = new Date()) {
  const t = sinAcentos(texto || "");
  const hoy = inicioDia(ahora), fin = ahora.getTime();
  const r = (desde, hasta, m) => ({ desde: desde.getTime(), hasta: typeof hasta === "number" ? hasta : hasta.getTime(), texto: m });
  let m;
  if ((m = t.match(/\banoche\b/))) return r(new Date(masDias(hoy, -1).getTime() + 18 * 3600e3), new Date(hoy.getTime() + 6 * 3600e3), m[0]);
  if ((m = t.match(/\b(?:anteayer|antier|antes de ayer)\b/))) return r(masDias(hoy, -2), masDias(hoy, -1), m[0]);
  if ((m = t.match(/\bayer\b/))) return r(masDias(hoy, -1), hoy, m[0]);
  if ((m = t.match(/\besta manana\b/))) return r(hoy, new Date(hoy.getTime() + 13 * 3600e3), m[0]);
  if ((m = t.match(/\b(?:hoy|esta tarde|esta noche)\b/))) return r(hoy, fin, m[0]);
  if ((m = t.match(/\b(?:la semana pasada|la semana anterior|el semana pasada)\b/))) return r(masDias(lunesDe(ahora), -7), lunesDe(ahora), m[0]);
  if ((m = t.match(/\besta semana\b/))) return r(lunesDe(ahora), fin, m[0]);
  if ((m = t.match(/\b(?:el mes pasado|el mes anterior)\b/))) return r(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1), new Date(ahora.getFullYear(), ahora.getMonth(), 1), m[0]);
  if ((m = t.match(/\beste mes\b/))) return r(new Date(ahora.getFullYear(), ahora.getMonth(), 1), fin, m[0]);
  if ((m = t.match(/\b(?:en )?(?:los )?ultimos (\d+|\w+) dias\b/))) { const n = +m[1] || NUMEROS[m[1]]; if (n) return r(masDias(hoy, -n), fin, m[0]); }
  if ((m = t.match(/\bhace (\d+|\w+) (dia|dias|semana|semanas|mes|meses)\b/))) {
    const n = +m[1] || NUMEROS[m[1]];
    if (n) {
      if (m[2].startsWith("dia")) return r(masDias(hoy, -n), masDias(hoy, -n + 1), m[0]);
      if (m[2].startsWith("semana")) return r(masDias(hoy, -7 * n - 3), masDias(hoy, -7 * n + 4), m[0]);
      return r(new Date(ahora.getFullYear(), ahora.getMonth() - n, 1), new Date(ahora.getFullYear(), ahora.getMonth() - n + 1, 1), m[0]);
    }
  }
  // «el martes», «el martes pasado»: el último que ya pasó, sin contar hoy
  if ((m = t.match(new RegExp(`\\b(?:el )?(${DIAS_SEMANA.join("|")})(?: pasado)?\\b`)))) {
    let atras = (ahora.getDay() - DIAS_SEMANA.indexOf(m[1]) + 7) % 7 || 7;
    return r(masDias(hoy, -atras), masDias(hoy, -atras + 1), m[0]);
  }
  return null;
}

// Palabras de la pregunta que hablan de la conversación misma, no de su tema
const SOBRE_CHARLA = /\b(?:que|de que|sobre que)?\s*(?:te|me|le)?\s*(?:dije|dijiste|conte|contaste|pregunte|preguntaste|comente|comentaste|mencione|mencionaste|pedi|pediste|respondiste|recomendaste|hablamos|conversamos|charlamos|hablado|platicamos|estuvimos hablando|habiamos hablado)\b|\b(?:acerca de|sobre|de lo|lo que|algo)\b|\b(?:conversacion|conversaciones|charla|charlas)\b/g;

const fecha = (t) => new Date(t).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const corta = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// consulta: de qué; cuando: «ayer», «la semana pasada»… (puede venir también dentro de la consulta)
function buscar({ consulta = "", cuando = "" } = {}, { ahora = new Date(), ruta } = {}) {
  const p = periodo(cuando, ahora) || periodo(consulta, ahora);
  let lista = turnos(ruta);
  if (p) lista = lista.filter((x) => x.t >= p.desde && x.t < p.hasta);
  const tema = sinAcentos(consulta).replace(p ? new RegExp(`\\b${p.texto}\\b`, "g") : /$^/, " ").replace(SOBRE_CHARLA, " ").replace(/\s+/g, " ").trim();
  // Con tema, lo que más se parece; sin tema («¿de qué hablamos ayer?»), lo más reciente de ese periodo
  // Si el tema no se encuentra, no hablaron de eso: mejor decirlo que traer otra conversación
  const elegidos = terminos(tema).length ? ordenarPorParecido(lista, tema) : [...lista].reverse();
  const salida = [];
  let total = 0;
  for (const x of elegidos) {
    const turno = { fecha: fecha(x.t), pregunta: corta(x.q, MAX_PREGUNTA), respuesta: corta(x.r, MAX_RESPUESTA) };
    const largo = turno.pregunta.length + turno.respuesta.length;
    if (salida.length >= MAX_TURNOS || total + largo > MAX_CARACTERES) break;
    total += largo; salida.push(turno);
  }
  return { consulta, ...(p ? { periodo: p.texto } : {}), turnos: salida, ...(aprendizaje.rutaRegistro() || ruta ? {} : { nota: "El registro de conversaciones no está activo." }) };
}
const formatear = (r) => r.turnos.map((x) => `- [${x.fecha}] Usuario: ${x.pregunta} — Merlín: ${x.respuesta}`).join("\n");

// Preguntas claras sobre conversaciones pasadas: con el modelo local se busca directamente, sin la primera vuelta
const INTENCION = /\b(?:que te (?:dije|conte|pregunte|comente|pedi|mencione)|que me (?:dijiste|respondiste|contaste|recomendaste)|de que (?:hablamos|conversamos|charlamos|estuvimos hablando)|(?:hablamos|conversamos|charlamos) (?:de|sobre|acerca)|te (?:dije|conte|hable|pregunte|comente) (?:de|sobre|que|acerca|lo))\b/;
const esPregunta = (texto) => INTENCION.test(sinAcentos(texto || ""));

module.exports = { turnos, periodo, buscar, formatear, esPregunta };
