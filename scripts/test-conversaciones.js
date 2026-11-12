// Búsqueda en conversaciones pasadas, sin modelo, sobre un registro de prueba:
//   node --no-warnings scripts/test-conversaciones.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merlin-conversaciones-"));
process.env.MERLIN_PERSONALIDAD = path.join(tmp, "Personalidad");
const c = require("../src/conversaciones");

let ok = 0, mal = 0;
const cierto = (nombre, v) => { if (v) ok++; else { mal++; console.log(`✘ ${nombre}`); } };
const igual = (nombre, real, esperado) => cierto(`${nombre}\n   real:     ${JSON.stringify(real)}\n   esperado: ${JSON.stringify(esperado)}`, JSON.stringify(real) === JSON.stringify(esperado));

// Miércoles 11 de noviembre de 2026, 15:00
const ahora = new Date(2026, 10, 11, 15, 0);
const en = (dias, hora) => new Date(2026, 10, 11 + dias, hora, 0).getTime();

// --- Cuándo ---
const p = (t) => { const r = c.periodo(t, ahora); return r && [new Date(r.desde).getDate(), new Date(r.hasta).getDate(), r.texto]; };
igual("ayer", p("¿de qué hablamos ayer?"), [10, 11, "ayer"]);
igual("anteayer", p("antes de ayer"), [9, 10, "antes de ayer"]);
igual("la semana pasada: de lunes a lunes", p("qué te dije la semana pasada"), [2, 9, "la semana pasada"]);
igual("esta semana", p("esta semana"), [9, 11, "esta semana"]);
igual("el martes: el último que pasó", p("el martes"), [10, 11, "el martes"]);
igual("el miércoles: hoy no cuenta, el anterior", p("el miércoles"), [4, 5, "el miercoles"]);
igual("hace 3 días", p("hace 3 días"), [8, 9, "hace 3 dias"]);
igual("hace dos semanas", p("hace dos semanas"), [25, 1, "hace dos semanas"]);
igual("los últimos diez días", p("en los últimos diez días"), [1, 11, "en los ultimos diez dias"]);
igual("el mes pasado", p("el mes pasado")?.slice(2), ["el mes pasado"]);
igual("anoche: de 18 a 6", (() => { const r = c.periodo("anoche", ahora); return [new Date(r.desde).getHours(), new Date(r.hasta).getHours()]; })(), [18, 6]);
igual("sin fecha", c.periodo("qué te dije del viaje", ahora), null);

// --- Registro de prueba ---
const ruta = path.join(tmp, "aprendizaje.jsonl");
const turno = (t, q, r, extra = {}) => JSON.stringify({ t, tipo: "turno", via: "claude", q, r, ...extra });
fs.writeFileSync(ruta, [
  turno(en(-1, 10), "estoy pensando en viajar a Japón en abril", "Abril es temporada de cerezos: buena elección, aunque habrá gente."),
  turno(en(-1, 20), "pon música de jazz", "Pongo Take Five.", { via: "programa" }),
  turno(en(-10, 12), "cómo se hace el pan amasado", "Harina, manteca, agua tibia, sal y levadura; se amasa bien y se hornea."),
  JSON.stringify({ t: en(-1, 11), tipo: "turno", via: "gemma", privado: true }),
  turno(en(-1, 12), "algo que falló", "Perdona, no supe qué responderte.", { via: "error" }),
  JSON.stringify({ t: en(-1, 13), tipo: "juicio", clave: "x", valor: "mal" }),
  "{esto no es json",
  turno(en(-2, 9), "recuérdame comprar pan mañana", "Anotado para mañana a las 9."),
].join("\n") + "\n");

const buscar = (consulta, cuando = "") => c.buscar({ consulta, cuando }, { ahora, ruta });
const preguntas = (r) => r.turnos.map((x) => x.pregunta);

igual("encuentra por tema", preguntas(buscar("¿qué te dije del viaje a Japón?")), ["estoy pensando en viajar a Japón en abril"]);
igual("variantes: «viajes» → «viajar»", preguntas(buscar("hablamos de viajes")), ["estoy pensando en viajar a Japón en abril"]);
igual("¿de qué hablamos ayer?: lo de ayer, lo último primero", preguntas(buscar("¿de qué hablamos ayer?")), ["pon música de jazz", "estoy pensando en viajar a Japón en abril"]);
igual("dice el periodo", buscar("¿de qué hablamos ayer?").periodo, "ayer");
igual("tema y fecha a la vez", preguntas(buscar("qué te dije del pan", "hace 10 días")), ["cómo se hace el pan amasado"]);
igual("el tema fuera de ese periodo: nada", preguntas(buscar("qué te dije ayer del pan amasado")), []);
igual("un tema del que no se habló: nada, no otra charla", preguntas(buscar("qué te dije de la Fórmula 1")), []);
igual("cuando va aparte", preguntas(buscar("música", "ayer")), ["pon música de jazz"]);
cierto("con fecha legible", /^[a-zé]{2,4}\.?,? 10 nov/.test(buscar("jazz").turnos[0].fecha));
const todo = buscar("", "en los últimos 90 días");
cierto("nunca trae turnos privados", !JSON.stringify(todo).includes("undefined") && todo.turnos.length === 4);
cierto("ni errores, juicios o líneas dañadas", !preguntas(todo).includes("algo que falló"));
igual("sin registro activo lo avisa", c.buscar({ consulta: "x" }).nota, "El registro de conversaciones no está activo.");

// Relee al cambiar el archivo
fs.appendFileSync(ruta, turno(en(0, 14), "mi equipo favorito es Colo-Colo", "Buen equipo, aunque yo soy más de gatos.") + "\n");
igual("ve lo nuevo", preguntas(buscar("equipo Colo-Colo")), ["mi equipo favorito es Colo-Colo"]);

// Límites
fs.writeFileSync(ruta, Array.from({ length: 40 }, (_, i) => turno(en(-3, 0) + i * 60000, `pregunta larga número ${i} sobre recetas de cocina ${"bla ".repeat(60)}`, "respuesta ".repeat(80))).join("\n") + "\n");
const muchas = buscar("recetas de cocina");
cierto("no más de 8 turnos", muchas.turnos.length <= 8 && muchas.turnos.length > 0);
cierto("ni más de 2500 caracteres", muchas.turnos.reduce((n, x) => n + x.pregunta.length + x.respuesta.length, 0) <= 2500);
cierto("recorta lo largo", muchas.turnos.every((x) => x.pregunta.length <= 200 && x.respuesta.length <= 300 && x.respuesta.endsWith("…")));

// --- Reconocer la pregunta ---
for (const t of ["¿Qué te dije ayer?", "qué te conté del viaje", "¿de qué hablamos la semana pasada?", "qué me dijiste de Japón", "¿hablamos de recetas?", "te dije que me iba a Japón, ¿no?", "¿qué me recomendaste el martes?"]) cierto(`reconoce «${t}»`, c.esPregunta(t));
for (const t of ["¿qué te parece el clima?", "dime qué hora es", "¿qué es Japón?", "pon música"]) cierto(`no confunde «${t}»`, !c.esPregunta(t));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
process.exit(mal ? 1 : 0);
