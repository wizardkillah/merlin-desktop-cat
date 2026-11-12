// El ciclo de aprendizaje de Merlín: registra cada conversación, recoge lo que el usuario corrige o enseña,
// y lo que se repite y funciona pasa a responderlo el programa, al instante.
//
// Reglas, para que un documento o una web no puedan enseñarle nada:
// - solo se aprende de lo que dice el usuario, y de respuestas dadas sin herramientas ni documentos;
// - lo que sale de documentos no se guarda, ni la pregunta ni la respuesta; tampoco lo que parezca un dato secreto;
// - lo que depende de la fecha o de la situación no se memoriza;
// - todo queda en notas editables, y «eso está mal» lo borra.
const fs = require("fs");
const path = require("path");
const personalidad = require("./personalidad");
const respuestas = require("./respuestas");

const MAX_REGISTROS = 3000, DIAS_REGISTRO = 90;
const VECES_PARA_APRENDER = 3, VECES_CON_APROBACION = 2;
const PLAZO_CORREGIR_MS = 5 * 60 * 1000, PLAZO_REPETIDA_MS = 90 * 1000, PLAZO_RESPUESTA_MS = 2 * 60 * 1000;

const FRASES_APRENDIZAJE = {
  pidoCorreccion: "Tienes razón, no lo repetiré. ¿Cuál es la respuesta correcta?",
  corregido: "Anotado. La próxima vez responderé eso.",
  ensenado: "Aprendido. Cuando me lo preguntes, ya sé qué decir.",
  privado: "Eso salió de tus documentos, así que no lo memorizo. Revisa la cita para comprobarlo.",
  nadaQueCorregir: "No tengo claro a qué te refieres. ¿Qué respuesta estaba mal?",
};
const APROBACIONES = ["Bien. Lo tendré presente.", "Me alegra. Lo dejo anotado.", "Perfecto, así lo seguiré haciendo."];

let archivo = null, informe = null, temporizador = null;
const preguntas = new Map(); // clave de la pregunta -> { texto, respuesta, veces, malas, buenas }
const cuentas = { total: 0, instantaneas: 0, cortes: 0, msModelo: 0, conModelo: 0, fallosOido: 0, lentosOido: 0 };
// Gasto de Claude por mes («2026-11»): dólares, preguntas y tokens
const gasto = new Map();
const mesDe = (t) => new Date(t).toISOString().slice(0, 7);
let ultimo = null, esperandoCorreccion = false, aprendidasAhora = 0;
// La respuesta a «eso está mal» no es «la última pregunta»: la corrección debe aplicarse a la anterior
let turnoDeAprendizaje = false;

const clave = (t) => respuestas.normal(t);

// Preguntas cuya respuesta cambia o depende de la conversación: no se memorizan
const NO_MEMORIZAR = /\b(hoy|ayer|manana|ahora|actual|actualmente|ultimo|ultima|ultimos|ultimas|reciente|precio|precios|dolar|uf|clima|tiempo|temperatura|noticia|noticias|hora|fecha|dia|semana|mes|ano|partido|gano|gana|cuesta|vale|mi|mis|me|yo|nuestro|nuestra|eso|esto|aqui|ahi|alli)\b/;
const memorizable = (t) => t.split(" ").length >= 3 && !/^y /.test(t) && !NO_MEMORIZAR.test(t);

function contar(r) {
  if (r.tipo === "voz") {
    if (r.ev === "cortada") cuentas.cortes++;
    else if (r.ev === "whisper-fallo") cuentas.fallosOido++;
    else if (r.ev === "whisper-lento") cuentas.lentosOido++;
    return;
  }
  if (r.tipo === "juicio") {
    const p = preguntas.get(r.clave);
    if (p) {
      if (r.valor === "mal") p.malas++;
      else if (r.valor === "bien") p.buenas++;
      else p.modelo = false; // corregida: ya está en la lista
    }
    return;
  }
  if (r.tipo !== "turno" && r.tipo !== "gasto") return;
  if (r.usd) {
    const g = gasto.get(mesDe(r.t || Date.now())) || { usd: 0, preguntas: 0, entrada: 0, salida: 0, leida: 0 };
    g.usd += r.usd; g.preguntas++; g.entrada += r.tokens?.entrada || 0; g.salida += r.tokens?.salida || 0; g.leida += r.tokens?.leida || 0;
    gasto.set(mesDe(r.t || Date.now()), g);
  }
  if (r.tipo === "gasto") return;
  cuentas.total++;
  if (r.via === "programa") cuentas.instantaneas++;
  else if (r.via === "claude" || r.via === "gemma") { cuentas.msModelo += r.ms || 0; cuentas.conModelo++; }
  if (!r.q) return; // privado o secreto
  const k = clave(r.q), p = preguntas.get(k) || { texto: r.q, respuesta: "", veces: 0, malas: 0, buenas: 0, modelo: false };
  p.texto = r.q; p.veces++;
  // Solo lo que el modelo respondió de memoria: lo que vino de Google, una web o la pantalla puede cambiar
  if ((r.via === "claude" || r.via === "gemma") && !(r.tools?.length)) { p.respuesta = r.r; p.modelo = true; }
  else if (r.tools?.length) p.modelo = false;
  if (r.via === "claude" || r.via === "gemma") p.ultimaVia = r.via;
  preguntas.set(k, p);
}

// Se llama al abrir el programa. Sin esto no se guarda nada: así las pruebas no ensucian los datos reales.
function iniciar(carpetaDatos) {
  archivo = path.join(carpetaDatos, "aprendizaje.jsonl");
  informe = path.join(path.dirname(personalidad.rutaRasgos()), "Por aprender.md");
  preguntas.clear(); gasto.clear(); Object.keys(cuentas).forEach((k) => (cuentas[k] = 0));
  ultimo = null; esperandoCorreccion = false; aprendidasAhora = 0;
  const limite = Date.now() - DIAS_REGISTRO * 24 * 3600 * 1000;
  let lineas = [];
  try { lineas = fs.readFileSync(archivo, "utf8").split(/\r?\n/).filter(Boolean); } catch {}
  const vivas = [];
  for (const l of lineas) {
    try { const r = JSON.parse(l); if (r.t >= limite) { vivas.push(l); contar(r); } } catch {}
  }
  const quedan = vivas.slice(-MAX_REGISTROS);
  if (quedan.length !== lineas.length) { try { fs.writeFileSync(archivo, quedan.map((l) => l + "\n").join("")); } catch {} }
  escribirInforme();
}

function anotar(r) {
  contar(r);
  if (!archivo) return;
  try { fs.appendFileSync(archivo, JSON.stringify({ t: Date.now(), ...r }) + "\n"); } catch (e) { console.log("[aprendizaje] no pude guardar:", e.message); }
  clearTimeout(temporizador);
  temporizador = setTimeout(escribirInforme, 4000);
  temporizador.unref?.();
}

// Lo que dice el usuario por sí mismo, en una frase entera: se guarda en sus notas y se le dice que se guardó.
const HECHOS = [
  [/^(?:me llamo|mi nombre es)\s+(.{2,40})$/i, (m) => `Me llamo ${m}`, (m) => `Mucho gusto, ${m}. Lo anoto en mi grimorio.`],
  [/^vivo en\s+(.{2,60})$/i, (m) => `Vivo en ${m}`],
  [/^trabajo (en|de|como)\s+(.{2,60})$/i, (m, n) => `Trabajo ${m} ${n}`],
  [/^(?:no )?me gusta(?:n)?\s+(.{2,70})$/i, null],
  [/^mi\s+(.{2,30}?)\s+favorit[oa]\s+es\s+(.{2,60})$/i, null],
  [/^tengo\s+(\d{1,3})\s+a[nñ]os$/i, (m) => `Tengo ${m} años`],
];
const sinPuntuacion = (t) => t.trim().replace(/^[¡¿]+/, "").replace(/[.!?…]+$/, "").trim();
const ANOTADO = "Anotado en mi grimorio. No lo olvidaré.";

function hechoDelUsuario(texto) {
  if (/[¿?]/.test(texto)) return null;
  const t = sinPuntuacion(texto);
  for (const [patron, formar, responder] of HECHOS) {
    const m = t.match(patron);
    if (!m) continue;
    const dato = formar ? formar(...m.slice(1)) : t;
    const r = personalidad.guardar(dato);
    if (r.error) return r.error === "secreto" ? personalidad.FRASES_MEMORIA.secreto : null;
    if (r.repetido) return personalidad.FRASES_MEMORIA.repetido;
    return responder ? responder(...m.slice(1)) : ANOTADO;
  }
  return null;
}

const ES_MAL = /^(?:no[, ]+)?(?:eso |esa respuesta |tu respuesta )?(?:est[aá] mal|es incorrect[oa]|no es correct[oa]|no es (?:as[ií]|cierto|verdad|eso)|es falso|te equivocaste|te has equivocado|est[aá]s equivocado|respondiste mal)$/i;
const ES_BIEN = /^(?:correcto|exacto|exactamente|perfecto|as[ií] es|eso es|muy bien|excelente|tienes raz[oó]n|esa es)$/i;
const CORRECCION = /^(?:(?:no|eso est[aá] mal|est[aá] mal)[,. ]+)?(?:la respuesta (?:correcta )?es|lo correcto es|en realidad es|se dice)\s+(.{2,300})$/i;
const NO_ES = /^no[,. ]+es\s+(?!que\b|as[ií]\b|cierto\b|verdad\b|eso\b)(.{2,200})$/i;
const ENSENAR = /^(?:si|cuando)\s+(?:alguien\s+)?(?:te\s+)?(?:pregunt\w+|digo|diga|dicen|digan)\s+(?:que\s+)?[«"“]?(.{3,120}?)[»"”]?[,.:]?\s+(?:responde|contesta|respondes|contestas|di|dime|debes decir|dices)(?:\s+que)?\s+[«"“]?(.{2,300}?)[»"”]?$/i;
const CUANTO = /^(?:cuanto|que tanto) has aprendido$/;
const GASTO = /^(?:cuanto (?:he gastado|llevo gastado|gaste|gastamos|has gastado|cuestas|me cuestas|me has costado)(?: en claude| este mes| con claude)*|cuanto (?:va|llevo) (?:de|en) (?:gasto|claude)|cual es mi gasto(?: de claude)?)$/;

const gastoMes = (ahora = Date.now()) => gasto.get(mesDe(ahora))?.usd || 0;
function resumenGasto() {
  const g = gasto.get(mesDe(Date.now()));
  if (!g) return "Este mes todavía no he gastado nada en Claude.";
  const dolares = g.usd < 0.01 ? "menos de un centavo de dólar" : `${g.usd.toFixed(2).replace(".", ",")} dólares`;
  return `Este mes llevo ${dolares} en Claude, en ${g.preguntas} ${g.preguntas === 1 ? "pregunta" : "preguntas"}.`;
}
const ES_PREGUNTA = /[¿?]|^(?:que|quien|como|cuando|donde|por que|cual|cuanto)\b/i;

function resumen() {
  const n = respuestas.total();
  return `Llevamos ${cuentas.total} preguntas. Ya respondo solo a ${n} temas, y ${aprendidasAhora ? `${aprendidasAhora} los aprendí hoy` : "sigo sumando"}.`;
}

// Corrige la última respuesta: guarda la buena, salvo que viniera de documentos
function corregir(correcta) {
  esperandoCorreccion = false;
  if (!ultimo?.q) return FRASES_APRENDIZAJE.privado;
  if (personalidad.esSecreto(correcta)) return personalidad.FRASES_MEMORIA.secreto;
  respuestas.anadir(ultimo.q, correcta, "corregida");
  anotar({ tipo: "juicio", clave: clave(ultimo.q), valor: "corregida" });
  aprendidasAhora++;
  return FRASES_APRENDIZAJE.corregido;
}

// Lo que el usuario dice sobre lo aprendido. Devuelve la respuesta, o null si no era para esto.
function atender(textoCrudo) {
  const r = interpretar(textoCrudo);
  turnoDeAprendizaje = r !== null;
  return r;
}

const SIN_RESPUESTA_USUARIO = /^(no se|no lo se|no recuerdo|da igual|nada|no|ninguna|olvidalo|dejalo|dejalo asi)$/;

function interpretar(textoCrudo) {
  const texto = sinPuntuacion(textoCrudo);
  const reciente = ultimo && Date.now() - ultimo.t < PLAZO_CORREGIR_MS;

  if (esperandoCorreccion) {
    const aTiempo = ultimo && Date.now() - ultimo.t < PLAZO_RESPUESTA_MS;
    esperandoCorreccion = false;
    if (aTiempo && !ES_PREGUNTA.test(textoCrudo.trim()) && !ES_MAL.test(texto) && !SIN_RESPUESTA_USUARIO.test(clave(texto))) return corregir(texto);
  }
  const ensena = texto.match(ENSENAR);
  if (ensena) {
    if (personalidad.esSecreto(`${ensena[1]} ${ensena[2]}`)) return personalidad.FRASES_MEMORIA.secreto;
    respuestas.anadir(ensena[1], ensena[2], "enseñada");
    aprendidasAhora++;
    return FRASES_APRENDIZAJE.ensenado;
  }
  if (reciente) {
    const correccion = texto.match(CORRECCION) || texto.match(NO_ES);
    if (correccion) return corregir(correccion[1]);
  }
  if (ES_MAL.test(texto)) {
    if (!reciente) return FRASES_APRENDIZAJE.nadaQueCorregir;
    if (!ultimo.q) return FRASES_APRENDIZAJE.privado;
    respuestas.quitar(ultimo.q);
    anotar({ tipo: "juicio", clave: clave(ultimo.q), valor: "mal" });
    esperandoCorreccion = true;
    ultimo.t = Date.now();
    return FRASES_APRENDIZAJE.pidoCorreccion;
  }
  if (reciente && ES_BIEN.test(texto) && ultimo.q) {
    anotar({ tipo: "juicio", clave: clave(ultimo.q), valor: "bien" });
    promover(clave(ultimo.q));
    return APROBACIONES[Math.floor(Math.random() * APROBACIONES.length)];
  }
  if (CUANTO.test(clave(texto))) return resumen();
  if (GASTO.test(clave(texto))) return resumenGasto();
  return hechoDelUsuario(textoCrudo);
}

// Lo que se repite, funciona y no depende del momento pasa a la lista: la próxima vez responde el programa
function promover(k) {
  if (!archivo) return false;
  const p = preguntas.get(k);
  if (!p || !p.modelo || !p.respuesta || p.malas > 0 || !memorizable(k) || p.respuesta.length < 12) return false;
  if (p.veces < (p.buenas > 0 ? VECES_CON_APROBACION : VECES_PARA_APRENDER)) return false;
  if (personalidad.esSecreto(p.texto) || personalidad.esSecreto(p.respuesta) || /https?:|⚠️/.test(p.respuesta)) return false;
  if (!respuestas.anadir(p.texto, p.respuesta, `aprendida tras ${p.veces} veces`)) return false;
  aprendidasAhora++;
  p.modelo = false;
  escribirInforme();
  return true;
}

// Se llama tras cada respuesta. «privado» y lo que parezca secreto no se guardan; el gasto sí, que no dice nada del contenido.
function registrar({ q, r, via, ms, tools = [], privado = false, voz = false, uso = null }) {
  const sensible = privado || personalidad.esSecreto(q) || personalidad.esSecreto(r);
  const k = clave(q);
  // Volver a preguntar lo mismo enseguida quiere decir que la respuesta anterior no sirvió
  if (ultimo?.q && !sensible && ultimo.clave === k && Date.now() - ultimo.t < PLAZO_REPETIDA_MS) anotar({ tipo: "juicio", clave: k, valor: "mal" });
  const costo = uso?.usd ? { usd: +uso.usd.toFixed(6), tokens: { entrada: uso.entrada + uso.escrita, salida: uso.salida, leida: uso.leida } } : {};
  anotar({ tipo: "turno", via, ms, tools, voz, ...costo, ...(sensible ? { privado: true } : { q, r }) });
  if (turnoDeAprendizaje) { turnoDeAprendizaje = false; return; }
  ultimo = { t: Date.now(), clave: k, q: sensible ? null : q, via };
  if (!sensible && tools.length === 0 && (via === "claude" || via === "gemma")) promover(k);
}

// Gasto de una pregunta que no terminó (cancelada o con error): sin texto, solo lo que costó
function registrarGasto(uso) {
  if (!uso?.usd) return;
  anotar({ tipo: "gasto", usd: +uso.usd.toFixed(6), tokens: { entrada: uso.entrada + uso.escrita, salida: uso.salida, leida: uso.leida } });
}

// Cuánto se alcanzó a oír de una respuesta cortada. Sirve para ver si Merlín se corta solo.
function registrarVoz(ev, datos = {}) { anotar({ tipo: "voz", ev, ...datos }); }

function escribirInforme() {
  if (!informe) return;
  const media = cuentas.conModelo ? Math.round(cuentas.msModelo / cuentas.conModelo / 100) / 10 : 0;
  const pendientes = [...preguntas.entries()]
    .filter(([, p]) => p.veces >= 2 && p.modelo)
    .sort((a, b) => b[1].veces - a[1].veces).slice(0, 25);
  const malas = [...preguntas.values()].filter((p) => p.malas > 0).sort((a, b) => b.malas - a.malas).slice(0, 15);
  const linea = (p) => `- ${p.texto.replace(/[\r\n]+/g, " ")} (${p.veces} veces)`;
  const texto = `---
tags: [gatito-brujo, personalidad, aprendizaje]
---
# Por aprender

Merlín reescribe esta nota sola, a partir de sus conversaciones: lo que escribas aquí se pierde. Para enseñarle, usa [[Respuestas]] o díselo hablando.

## Cómo va
- Preguntas respondidas: ${cuentas.total}
- Respondidas al instante, sin modelo: ${cuentas.instantaneas}${cuentas.total ? ` (${Math.round((cuentas.instantaneas / cuentas.total) * 100)} %)` : ""}
- Tiempo medio con modelo: ${media} s
- Respuestas en la lista: ${respuestas.total()}
- Respuestas cortadas al hablar: ${cuentas.cortes}
- Fallos de whisper.cpp (esa frase la oyó el Whisper de respaldo, que reconoce peor): ${cuentas.fallosOido}
- Transcripciones lentas, de más de 5 s: ${cuentas.lentosOido}

## Gasto de Claude
${[...gasto.entries()].sort().reverse().slice(0, 6).map(([mes, g]) => `- ${mes}: ${g.usd.toFixed(3)} US$ en ${g.preguntas} preguntas, ${(g.usd / g.preguntas).toFixed(4)} US$ de media. Tokens: ${g.entrada} de entrada, ${g.leida} leídos de la caché, ${g.salida} de salida`).join("\n") || "Nada todavía."}

## Se repiten y aún las responde el modelo
${pendientes.length ? pendientes.map(([, p]) => linea(p)).join("\n") : "Ninguna por ahora."}

## Las que el usuario marcó como malas
${malas.length ? malas.map(linea).join("\n") : "Ninguna por ahora."}
`;
  try { fs.mkdirSync(path.dirname(informe), { recursive: true }); fs.writeFileSync(informe, texto); } catch (e) { console.log("[aprendizaje] no pude escribir el informe:", e.message); }
}

const rutaInforme = () => informe;

// Dónde está el registro de conversaciones (null si no se inició: entonces no hay nada que buscar)
const rutaRegistro = () => archivo;

module.exports = { rutaRegistro, gastoMes, resumenGasto, FRASES_APRENDIZAJE, APROBACIONES, iniciar, atender, registrar, registrarGasto, registrarVoz, promover, resumen, escribirInforme, rutaInforme, memorizable };
