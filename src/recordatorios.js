// Recordatorios, alarmas, temporizadores y cumpleaños. Las órdenes se entienden en el programa, sin modelo,
// se guardan en un archivo local y Merlín avisa en voz alta a su hora, aunque la app se haya cerrado entre medio.
// Un aviso solo cuenta como entregado cuando la ventana confirma que lo mostró y lo dijo.
const fs = require("fs");
const path = require("path");
const personalidad = require("./personalidad");
const { normalizar } = require("./charla");

const MIN = 60000, HORA = 60 * MIN, DIA = 24 * HORA;
const PLAZO_PREGUNTA_MS = 60000, TARDE_MS = 5 * MIN, GUARDAR_ENTREGADOS_DIAS = 7;

// Minúsculas y sin tildes, con la misma longitud: así lo encontrado se puede recortar del texto original
const plano = (s) => s.toLowerCase().replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n");

const NUMEROS = {
  "cuarenta y cinco": 45, "treinta y cinco": 35, "veinticinco": 25, "diecinueve": 19, "dieciocho": 18, "diecisiete": 17, "dieciseis": 16,
  "cincuenta": 50, "cuarenta": 40, "treinta": 30, "noventa": 90, "catorce": 14, "quince": 15, "veinte": 20, "cuatro": 4, "cinco": 5,
  "nueve": 9, "siete": 7, "trece": 13, "ocho": 8, "once": 11, "doce": 12, "diez": 10, "seis": 6, "tres": 3, "dos": 2, "uno": 1, "una": 1, "un": 1, "cien": 100,
};
const N = `(\\d+(?:[.,]\\d+)?|${Object.keys(NUMEROS).join("|")})`;
const numero = (s) => (s in NUMEROS ? NUMEROS[s] : Number(s.replace(",", ".")));
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const UNIDAD = { segundo: 1000, minuto: MIN, min: MIN, hora: HORA, dia: DIA };

const ORDEN = /^(?:(?:oye|hey|hola) )?(?:merlin[, ]+)?(?:por favor[, ]+)?(avisame|recuerdame|acuerdame|despiertame|ponme un recordatorio|pon un recordatorio|crea un recordatorio|haz un recordatorio|anota un recordatorio|ponme una alarma|pon una alarma|ponme un temporizador|pon un temporizador|programa una alarma|programa un temporizador|temporizador|alarma|cuenta)\b[, ]*/;

const SUAVE = /^(?:(?:oye|hey|hola) )?(?:merlin[, ]+)?(?:por favor[, ]+)?(recuerda|acuerdate de|no olvides|no te olvides de) que\b[, ]*/;

// Lo que dura un temporizador o falta para un aviso: «en 20 minutos», «dentro de media hora», «de 5 minutos»
const RELATIVO = [
  [new RegExp(`\\b(?:en|dentro de|de|por) (?:unos |unas )?${N} (segundo|minuto|min|hora|dia)s?( y media| y medio| y cuarto)?\\b`), (m) => numero(m[1]) * UNIDAD[m[2]] + (m[3] ? (m[3].includes("cuarto") ? 0.25 : 0.5) * UNIDAD[m[2]] : 0)],
  [/\b(?:en|dentro de|de|por) (?:una )?hora y media\b/, () => 1.5 * HORA],
  [/\b(?:en|dentro de|de|por) media hora\b/, () => 30 * MIN],
  [/\b(?:en|dentro de|de|por) (?:un )?cuarto de hora\b/, () => 15 * MIN],
  [/\b(?:en|dentro de) un rato\b/, () => 30 * MIN],
];
const HORA_EXACTA = new RegExp(`\\b(?:a las?|para las?|a eso de las?) ${N}(?:[:.](\\d{2}))?(?: (y media|y cuarto|menos cuarto|y ${N}))?(?: (de la manana|de la tarde|de la noche|de la madrugada|am|pm|hrs|horas))?\\b`);
const MEDIODIA = /\b(?:al|a) mediodia\b/;
const DIA_RE = new RegExp(`\\b(pasado manana|manana|hoy|esta tarde|esta noche|esta manana|el (${DIAS_SEMANA.join("|")})|(?:el )?(?:proximo|siguiente) (${DIAS_SEMANA.join("|")}))\\b`);

const recortar = (texto, ini, fin) => texto.slice(0, ini) + " ".repeat(fin - ini) + texto.slice(fin);

// Saca el momento de una frase. Devuelve { cuando, relativo, hueco } o null. «hueco» es la frase sin el momento.
function leerMomento(original, ahora = new Date()) {
  let p = plano(original), relativo = null;
  for (const [re, ms] of RELATIVO) {
    const m = p.match(re);
    if (m) { relativo = ms(m); p = recortar(p, m.index, m.index + m[0].length); break; }
  }
  if (relativo !== null) return { cuando: ahora.getTime() + relativo, relativo, hueco: p };

  let h = null, mins = 0, meridiano = "", conHora = false;
  let m = p.match(HORA_EXACTA);
  if (m) {
    h = numero(m[1]); mins = m[2] ? Number(m[2]) : 0;
    if (m[3] === "y media") mins = 30; else if (m[3] === "y cuarto") mins = 15; else if (m[3] === "menos cuarto") { h -= 1; mins = 45; } else if (m[4]) mins = numero(m[4]);
    meridiano = m[5] || ""; conHora = true;
    p = recortar(p, m.index, m.index + m[0].length);
  } else if ((m = p.match(MEDIODIA))) { h = 12; conHora = true; p = recortar(p, m.index, m.index + m[0].length); }

  let diaOffset = null, diaTexto = "";
  m = p.match(DIA_RE);
  if (m) {
    diaTexto = m[1];
    const semana = m[2] || m[3];
    if (semana) { const d = DIAS_SEMANA.indexOf(semana); diaOffset = ((d - ahora.getDay() + 7) % 7) || 7; }
    else diaOffset = { "pasado manana": 2, manana: 1 }[diaTexto] ?? 0;
    p = recortar(p, m.index, m.index + m[0].length);
  }
  if (!conHora && diaOffset === null) return null;
  if (!conHora) h = { "esta tarde": 17, "esta noche": 21, "esta manana": 9 }[diaTexto] ?? 9;
  if (h === null || h > 24 || mins > 59) return null;
  if (/tarde|noche|pm/.test(meridiano) && h < 12) h += 12;
  else if (/manana|madrugada|am/.test(meridiano) && h === 12) h = 0;
  else if (!meridiano && /tarde|noche/.test(diaTexto) && h < 12) h += 12;
  else if (!meridiano && diaOffset !== null && h >= 1 && h <= 7) h += 12; // «mañana a las 3»: las tres de la tarde

  const d = new Date(ahora); d.setSeconds(0, 0); d.setHours(h, mins);
  if (diaOffset !== null) d.setDate(d.getDate() + diaOffset);
  else if (d <= ahora) {
    // Sin día: la próxima vez que llegue esa hora. «A las 5» a las 15:00 son las 17:00.
    if (!meridiano && h < 12 && new Date(d.getTime() + 12 * HORA) > ahora) d.setHours(h + 12);
    else d.setDate(d.getDate() + 1);
  }
  return { cuando: d.getTime(), relativo: 0, hueco: p };
}

// «Tengo que sacar el pan» → «tienes que sacar el pan»: se le dice al usuario, no a Merlín
const DE_TU = [[/\btengo\b/g, "tienes"], [/\bdebo\b/g, "debes"], [/\bvoy\b/g, "vas"], [/\bestoy\b/g, "estás"], [/\bmis\b/g, "tus"], [/\bmi\b/g, "tu"], [/\bme\b/g, "te"], [/\bsoy\b/g, "eres"], [/\bpuedo\b/g, "puedes"]];
function asuntoDe(original, hueco) {
  // Se toma del texto original lo que quedó fuera del momento, para conservar tildes y mayúsculas
  let s = "";
  for (let i = 0; i < original.length; i++) s += hueco[i] === " " && original[i] !== " " ? " " : original[i];
  s = s.replace(/\s+/g, " ").trim()
    .replace(/^[,.;:\s]+|[,.;:!?¡¿\s]+$/g, "")
    .replace(/^(?:que|de que|de|para|a|sobre|lo de|del)\s+/i, "")
    .replace(/^(?:que|de)\s+/i, "")
    .trim();
  if (!s || /^(?:un|una|el|la)?\s*(?:recordatorio|alarma|temporizador|aviso)$/i.test(s)) return "";
  for (const [re, por] of DE_TU) s = s.replace(re, por);
  return s;
}

// ---------- Almacén ----------
let archivo = null, lista = [], siguienteId = 1, preguntaPendiente = null;

function iniciar(carpeta) {
  archivo = path.join(carpeta, "recordatorios.json");
  try { lista = JSON.parse(fs.readFileSync(archivo, "utf8")); } catch { lista = []; }
  siguienteId = lista.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  limpiarViejos();
}
function guardar() {
  if (!archivo) return;
  try { fs.writeFileSync(archivo + ".tmp", JSON.stringify(lista, null, 1)); fs.renameSync(archivo + ".tmp", archivo); }
  catch (e) { console.log("[recordatorios] no pude guardar:", e.message); }
}
function limpiarViejos(ahora = Date.now()) {
  lista = lista.filter((r) => !r.entregado || ahora - r.entregado < GUARDAR_ENTREGADOS_DIAS * DIA);
}

function crear({ cuando, asunto = "", tipo = "aviso", etiqueta = "", repetir = null }) {
  const r = { id: siguienteId++, cuando, asunto, tipo, etiqueta, repetir, creado: Date.now(), entregado: null };
  lista.push(r); guardar();
  return r;
}
const activos = () => lista.filter((r) => !r.entregado).sort((a, b) => a.cuando - b.cuando);

// ---------- Cómo se dice ----------
const dosCifras = (n) => String(n).padStart(2, "0");
const horaDe = (d) => `${d.getHours()}:${dosCifras(d.getMinutes())}`;
function duracion(ms) {
  if (ms < MIN) return `${Math.round(ms / 1000)} segundos`;
  const h = Math.floor(ms / HORA), m = Math.round((ms % HORA) / MIN);
  const partes = [];
  if (h) partes.push(h === 1 ? "1 hora" : `${h} horas`);
  if (m) partes.push(m === 1 ? "1 minuto" : `${m} minutos`);
  return partes.join(" y ") || "un momento";
}
function momentoDicho(cuando, ahora = new Date()) {
  const d = new Date(cuando), dias = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(ahora).setHours(0, 0, 0, 0)) / DIA);
  const dia = dias === 0 ? "hoy" : dias === 1 ? "mañana" : dias === 2 ? "pasado mañana" : dias < 7 ? `el ${["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][d.getDay()]}` : `el ${d.getDate()} de ${MESES[d.getMonth()]}`;
  return `${dia} a las ${horaDe(d)}`;
}

// Lo que dice Merlín cuando llega la hora
function fraseAviso(r, ahora = Date.now()) {
  const tarde = ahora - r.cuando > TARDE_MS ? `Se me pasó la hora mientras estaba apagado: era ${momentoDicho(r.cuando, new Date(ahora)).replace(/^hoy /, "")}. ` : "";
  if (r.tipo === "cumpleanos") return `${tarde}¡Feliz cumpleaños! Que tengas un día estupendo. Hasta los gatos brujos celebran.`;
  if (r.asunto) return `${tarde}Te recuerdo: ${r.asunto}.`;
  if (r.tipo === "temporizador") return `${tarde}Tiempo. Ya pasaron los ${r.etiqueta}.`;
  return `${tarde}Son las ${horaDe(new Date(r.cuando))}. Tu alarma.`;
}

// ---------- Órdenes ----------
const LISTAR = /^(?:que recordatorios tengo|cuales son mis recordatorios|mis recordatorios|tengo (?:algun |algunos )?(?:recordatorios?|pendientes?|alarmas?)|que tengo pendiente|que (?:tengo|hay) (?:para )?(hoy|manana)|que alarmas tengo|lista de recordatorios)$/;
const CANCELAR = /^(?:cancela|borra|elimina|quita|anula)(?: (?:el|la|los|las|mi|mis|todos los|todas las))? (recordatorio|recordatorios|temporizador|temporizadores|alarma|alarmas)(?: (?:de|del|que|para|sobre) (.+))?$/;
const CUMPLE = new RegExp(`^(?:mi cumpleanos es|cumplo anos|mi cumple es|naci)(?: el)? ${N} de (${MESES.join("|")})(?: de \\d{4})?$`);

const lugarEnLista = (r, ahora) => `${r.asunto || (r.tipo === "temporizador" ? `temporizador de ${r.etiqueta}` : "alarma")}, ${momentoDicho(r.cuando, ahora)}`;

// Devuelve la respuesta de Merlín, o null si la frase no es para esto
function atender(textoCrudo, ahora = new Date()) {
  const original = textoCrudo.trim().replace(/[.!¡]+$/, "");
  const t = normalizar(original);
  if (!t) return null;

  const pendiente = preguntaPendiente && ahora - preguntaPendiente.t < PLAZO_PREGUNTA_MS ? preguntaPendiente : null;
  preguntaPendiente = null;

  if (LISTAR.test(t)) {
    const dia = t.match(LISTAR)[1];
    let pend = activos();
    if (dia) {
      const objetivo = new Date(ahora); objetivo.setDate(objetivo.getDate() + (dia === "manana" ? 1 : 0));
      pend = pend.filter((r) => new Date(r.cuando).toDateString() === objetivo.toDateString());
      if (!pend.length) return dia === "hoy" ? "Para hoy no tengo nada anotado." : "Para mañana no tengo nada anotado.";
    }
    if (!pend.length) return "No tienes recordatorios pendientes.";
    const lista = pend.slice(0, 5).map((r) => lugarEnLista(r, ahora));
    return `${pend.length === 1 ? "Tienes uno" : `Tienes ${pend.length}`}: ${lista.join("; ")}${pend.length > 5 ? ", y más" : ""}.`;
  }

  const c = t.match(CANCELAR);
  if (c) {
    const tipo = /temporizador/.test(c[1]) ? "temporizador" : /alarma/.test(c[1]) ? "alarma" : null;
    let candidatos = activos().filter((r) => r.tipo !== "cumpleanos" && (!tipo || r.tipo === tipo || (tipo === "alarma" && r.tipo === "aviso" && !r.asunto)));
    if (c[2]) { const claves = c[2].split(" ").filter((w) => w.length > 2); candidatos = candidatos.filter((r) => claves.some((k) => normalizar(r.asunto).includes(k))); }
    if (!candidatos.length) return "No encuentro ese recordatorio.";
    const todos = /s$/.test(c[1]) || /todos|todas/.test(t);
    const quitar = todos ? candidatos : [candidatos[0]];
    lista = lista.filter((r) => !quitar.includes(r)); guardar();
    return quitar.length === 1 ? `Listo, cancelé: ${lugarEnLista(quitar[0], ahora)}.` : `Listo, cancelé ${quitar.length} recordatorios.`;
  }

  const cu = t.match(CUMPLE);
  if (cu) {
    const dia = numero(cu[1]), mes = MESES.indexOf(cu[2]);
    if (dia < 1 || dia > 31) return null;
    personalidad.guardar(`Mi cumpleaños es el ${dia} de ${cu[2]}`);
    lista = lista.filter((r) => r.tipo !== "cumpleanos");
    const d = new Date(ahora.getFullYear(), mes, dia, 9, 0);
    if (d <= ahora) d.setFullYear(d.getFullYear() + 1);
    crear({ cuando: d.getTime(), tipo: "cumpleanos", repetir: "anual" });
    return `Anotado: el ${dia} de ${cu[2]}. Ese día te saludo yo primero.`;
  }

  const plana = plano(original);
  let orden = plana.match(ORDEN);
  // «Recuerda que mañana a las 9 tengo dentista» es un aviso; sin momento, es un dato para la memoria
  if (!orden) {
    const suave = plana.match(SUAVE);
    if (suave && leerMomento(original.slice(suave[0].length), ahora)) orden = suave;
  }
  if (!orden && !pendiente) return null;
  const sinOrden = orden ? original.slice(orden[0].length) : original;
  const momento = leerMomento(sinOrden, ahora);
  if (!momento) {
    if (!orden) return null;
    preguntaPendiente = { t: ahora.getTime(), orden: orden[1], texto: sinOrden };
    return "¿Cuándo te aviso?";
  }
  // Respuesta a «¿cuándo te aviso?»: el asunto venía en la frase anterior
  const base = orden ? sinOrden : pendiente.texto;
  const asunto = orden ? asuntoDe(sinOrden, momento.hueco) : asuntoDe(base, plano(base));
  const palabra = orden ? orden[1] : pendiente.orden;
  if (momento.cuando - ahora.getTime() < 5000) return "Eso ya pasó. ¿Para cuándo lo anoto?";
  if (momento.cuando - ahora.getTime() > 366 * DIA) return "Eso es demasiado lejos hasta para un brujo. Pídemelo dentro del año.";
  const tipo = momento.relativo && !asunto && !/despiertame|alarma/.test(palabra) ? "temporizador" : "aviso";
  crear({ cuando: momento.cuando, asunto, tipo, etiqueta: momento.relativo ? duracion(momento.relativo) : "" });
  const cuandoDicho = momento.relativo && momento.relativo < 12 * HORA ? `en ${duracion(momento.relativo)}` : momentoDicho(momento.cuando, ahora);
  if (tipo === "temporizador") return `Temporizador de ${duracion(momento.relativo)} en marcha.`;
  if (!asunto) return `Listo, ${/despiertame/.test(palabra) ? "te despierto" : "te aviso"} ${cuandoDicho}.`;
  return `Listo, te aviso ${cuandoDicho}: ${asunto}.`;
}

// Para Claude o Gemma: la misma orden en palabras, como la diría el usuario
function crearDesdeTexto(orden, ahora = new Date()) {
  const r = atender(`recuérdame ${orden}`, ahora);
  if (!r || r === "¿Cuándo te aviso?") { preguntaPendiente = null; return { error: "No entendí cuándo. Indica el momento, por ejemplo «en 20 minutos» o «mañana a las 9»." }; }
  return { ok: true, frase: r };
}

// Los que ya tocan. La ventana los confirma con entregado(id).
const vencidos = (ahora = Date.now()) => activos().filter((r) => r.cuando <= ahora);
function entregado(id, ahora = Date.now()) {
  const r = lista.find((x) => x.id === id);
  if (!r || r.entregado) return;
  if (r.repetir === "anual") { const d = new Date(r.cuando); while (d.getTime() <= ahora) d.setFullYear(d.getFullYear() + 1); r.cuando = d.getTime(); }
  else r.entregado = ahora;
  limpiarViejos(ahora); guardar();
}

const reiniciar = () => { lista = []; siguienteId = 1; preguntaPendiente = null; archivo = null; };

module.exports = { atender, crearDesdeTexto, leerMomento, iniciar, vencidos, entregado, fraseAviso, activos, duracion, reiniciar };
