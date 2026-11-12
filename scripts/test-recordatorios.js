// Prueba recordatorios, cumpleaños y gasto, con reloj fijo y carpetas temporales:
//   node --no-warnings scripts/test-recordatorios.js
const fs = require("fs"), os = require("os"), path = require("path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merlin-recordatorios-"));
process.env.MERLIN_PERSONALIDAD = path.join(tmp, "notas");
const rec = require("../src/recordatorios");
const personalidad = require("../src/personalidad");
const aprendizaje = require("../src/aprendizaje");
const claude = require("../src/claude");

let ok = 0, mal = 0;
const igual = (nombre, real, esperado) => {
  const r = JSON.stringify(real), e = JSON.stringify(esperado);
  if (r === e) { ok++; return; }
  mal++; console.log(`✘ ${nombre}\n   real:     ${r}\n   esperado: ${e}`);
};
const cierto = (nombre, v) => igual(nombre, !!v, true);

const AHORA = new Date(2026, 10, 9, 15, 0); // lunes 9 de noviembre, 15:00
const hhmm = (ms) => { const d = new Date(ms); return `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
const momento = (t) => { const m = rec.leerMomento(t, AHORA); return m ? hhmm(m.cuando) : null; };

// ---------- Momentos ----------
igual("en 20 minutos", momento("en 20 minutos sacar el pan"), "9 15:20");
igual("en veinte minutos", momento("en veinte minutos"), "9 15:20");
igual("en media hora", momento("en media hora"), "9 15:30");
igual("en hora y media", momento("dentro de una hora y media"), "9 16:30");
igual("en 2 horas y media", momento("en 2 horas y media"), "9 17:30");
igual("de 5 minutos", momento("de 5 minutos"), "9 15:05");
igual("a las 5, ya de tarde", momento("a las 5"), "9 17:00");
igual("a las 17:30", momento("a las 17:30"), "9 17:30");
igual("a las 9 de la mañana: mañana", momento("a las 9 de la mañana"), "10 9:00");
igual("a las 3 y media", momento("a las 3 y media"), "9 15:30");
igual("mañana a las 9", momento("mañana a las 9"), "10 9:00");
igual("mañana a las 3 es de tarde", momento("mañana a las 3"), "10 15:00");
igual("mañana sin hora", momento("mañana llamar a Juan"), "10 9:00");
igual("pasado mañana", momento("pasado mañana a las 10"), "11 10:00");
igual("esta noche", momento("esta noche"), "9 21:00");
igual("el viernes", momento("el viernes a las 8 de la noche"), "13 20:00");
igual("el lunes es el próximo", momento("el lunes"), "16 9:00");
igual("al mediodía ya pasó: mañana", momento("al mediodía"), "10 12:00");
igual("menos cuarto", momento("a las 6 menos cuarto"), "9 17:45");
igual("sin momento", momento("sacar el pan"), null);

// ---------- Órdenes ----------
rec.reiniciar();
const r = (t) => rec.atender(t, AHORA);
igual("relativo", r("Recuérdame en 20 minutos sacar el pan del horno."), "Listo, te aviso en 20 minutos: sacar el pan del horno.");
igual("asunto antes", r("Avísame que tengo que llamar a mi mamá mañana a las 9."), "Listo, te aviso mañana a las 9:00: tienes que llamar a tu mamá.");
igual("con el nombre delante", r("Merlín, recuérdame a las 6 de la tarde regar las plantas"), "Listo, te aviso hoy a las 18:00: regar las plantas.");
igual("temporizador", r("Pon un temporizador de 5 minutos"), "Temporizador de 5 minutos en marcha.");
igual("alarma", r("Despiértame mañana a las 7"), "Listo, te despierto mañana a las 19:00.");
igual("alarma de la mañana", r("Despiértame mañana a las 7 de la mañana"), "Listo, te despierto mañana a las 7:00.");
igual("recuerda que con hora es un aviso", r("Recuerda que mañana a las 10 tengo dentista"), "Listo, te aviso mañana a las 10:00: tienes dentista.");
igual("recuerda que sin hora no es para esto", r("Recuerda que mi color favorito es el verde"), null);
igual("pregunta el momento", r("Recuérdame comprar leche"), "¿Cuándo te aviso?");
igual("y lo completa", r("En una hora"), "Listo, te aviso en 1 hora: comprar leche.");
igual("ya pasó", r("Recuérdame en 0 minutos algo"), "Eso ya pasó. ¿Para cuándo lo anoto?");
for (const t of ["¿Qué hora es?", "Recuérdame cómo te llamas", "La alarma del auto suena mucho", "Pon Queen en YouTube"]) {
  const res = r(t);
  if (t.startsWith("Recuérdame")) { igual(`pregunta cuándo: ${t}`, res, "¿Cuándo te aviso?"); r("¿qué hora es?"); }
  else igual(`no es recordatorio: ${t}`, res, null);
}
igual("una pregunta no responde al «¿cuándo?»", (r("Recuérdame comprar pan"), r("¿Qué hora es?")), null);

const lista = r("¿Qué recordatorios tengo?");
cierto("lista en orden de hora", /^Tienes 8: temporizador de 5 minutos, hoy a las 15:05; sacar el pan del horno, hoy a las 15:20; comprar leche, hoy a las 16:00.*y más\.$/.test(lista));
cierto("hoy", /^Tienes 4: .*regar las plantas, hoy a las 18:00\.$/.test(r("¿Qué tengo hoy?")));
cierto("mañana", /tienes que llamar a tu mamá/.test(r("Qué tengo para mañana")));
igual("cancelar por tema", r("Cancela el recordatorio de las plantas"), "Listo, cancelé: regar las plantas, hoy a las 18:00.");
igual("cancelar temporizador", r("Cancela el temporizador"), "Listo, cancelé: temporizador de 5 minutos, hoy a las 15:05.");
igual("cancelar algo que no está", r("Cancela el recordatorio del gimnasio"), "No encuentro ese recordatorio.");

// ---------- Entrega ----------
const venc = rec.vencidos(AHORA.getTime() + 21 * 60000);
igual("vence a su hora", venc.map((x) => x.asunto), ["sacar el pan del horno"]);
igual("frase", rec.fraseAviso(venc[0], AHORA.getTime() + 21 * 60000), "Te recuerdo: sacar el pan del horno.");
cierto("tarde lo dice", /^Se me pasó la hora/.test(rec.fraseAviso(venc[0], AHORA.getTime() + 3 * 3600000)));
rec.entregado(venc[0].id, AHORA.getTime() + 21 * 60000);
igual("entregado no vuelve", rec.vencidos(AHORA.getTime() + 21 * 60000).length, 0);
igual("frase de temporizador", rec.fraseAviso({ tipo: "temporizador", etiqueta: "5 minutos", cuando: 0 }, 0), "Tiempo. Ya pasaron los 5 minutos.");

// ---------- Persistencia ----------
rec.iniciar(tmp);
r("Recuérdame en 10 minutos estirar las piernas");
rec.reiniciar(); rec.iniciar(tmp);
igual("sobrevive a reiniciar", rec.activos().map((x) => x.asunto), ["estirar las piernas"]);

// ---------- Cumpleaños ----------
igual("cumpleaños", r("Mi cumpleaños es el 3 de mayo."), "Anotado: el 3 de mayo. Ese día te saludo yo primero.");
cierto("queda en la memoria", personalidad.listar().includes("Mi cumpleaños es el 3 de mayo"));
const cumple = rec.activos().find((x) => x.tipo === "cumpleanos");
igual("el próximo 3 de mayo", hhmm(cumple.cuando), "3 9:00");
rec.entregado(cumple.id, cumple.cuando + 1000);
igual("se repite cada año", new Date(rec.activos().find((x) => x.tipo === "cumpleanos").cuando).getFullYear(), 2028);

// ---------- Gasto ----------
igual("costo Opus", +claude.costo({ input_tokens: 1000, output_tokens: 100 }, "claude-opus-5-5").usd.toFixed(4), 0.006);
igual("caché más barata", +claude.costo({ cache_read_input_tokens: 1500, input_tokens: 20, output_tokens: 100 }, "claude-opus-5-5").usd.toFixed(5), 0.00238);
igual("escribir caché", +claude.costo({ cache_creation_input_tokens: 1000 }, "claude-opus-5-5").usd.toFixed(4), 0.005);
igual("Haiku", +claude.costo({ input_tokens: 1000, output_tokens: 100 }, "claude-haiku-5-5").usd.toFixed(5), 0.00015);
claude.usarModelo("claude-haiku-5-5"); igual("cambia el modelo", claude.modelo(), "claude-haiku-5-5");
claude.usarModelo("gpt-x"); igual("rechaza uno desconocido", claude.modelo(), "claude-haiku-5-5");

aprendizaje.iniciar(path.join(tmp));
igual("sin gasto", aprendizaje.resumenGasto(), "Este mes todavía no he gastado nada en Claude.");
aprendizaje.registrar({ q: "cuál es la capital de Chile", r: "Santiago.", via: "claude", ms: 900, uso: { entrada: 30, escrita: 1500, leida: 0, salida: 120, usd: 0.0099 } });
aprendizaje.registrar({ q: "qué dice mi contrato", r: "x", via: "claude", ms: 900, privado: true, uso: { entrada: 30, escrita: 0, leida: 1500, salida: 120, usd: 0.0028 } });
igual("suma el mes", +aprendizaje.gastoMes().toFixed(4), 0.0127);
igual("responde el gasto", aprendizaje.atender("¿Cuánto he gastado en Claude?"), "Este mes llevo 0,01 dólares en Claude, en 2 preguntas.");
const registro = fs.readFileSync(path.join(tmp, "aprendizaje.jsonl"), "utf8");
cierto("el privado guarda el gasto pero no el texto", registro.includes('"usd":0.0028') && !registro.includes("contrato"));
aprendizaje.iniciar(path.join(tmp));
igual("el gasto sobrevive a reiniciar", +aprendizaje.gastoMes().toFixed(4), 0.0127);
aprendizaje.escribirInforme();
cierto("el informe muestra el gasto", /2026-\d\d: 0\.013 US\$ en 2 preguntas/.test(fs.readFileSync(aprendizaje.rutaInforme(), "utf8")));

console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(mal ? 1 : 0);
