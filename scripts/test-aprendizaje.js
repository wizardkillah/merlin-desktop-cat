// Prueba la lista de respuestas y el ciclo de aprendizaje, en carpetas temporales:
//   node --no-warnings scripts/test-aprendizaje.js
const fs = require("fs"), os = require("os"), path = require("path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merlin-aprende-"));
process.env.MERLIN_PERSONALIDAD = path.join(tmp, "notas");
const datos = path.join(tmp, "datos"); fs.mkdirSync(datos);

const respuestas = require("../src/respuestas");
const aprendizaje = require("../src/aprendizaje");
const personalidad = require("../src/personalidad");
const brain = require("../src/brain");
const { responderDato } = require("../src/charla");
const { FRASES_APRENDIZAJE: F } = aprendizaje;

let ok = 0, mal = 0;
const igual = (nombre, real, esperado) => {
  const r = JSON.stringify(real), e = JSON.stringify(esperado);
  if (r === e) { ok++; return; }
  mal++; console.log(`✘ ${nombre}\n   real:     ${r}\n   esperado: ${e}`);
};
const cierto = (nombre, v) => igual(nombre, !!v, true);

// ---------- Lista ----------
respuestas.asegurar();
cierto("crea la nota con la lista base", respuestas.total() >= 40);
cierto("toda línea de la lista tiene respuesta", respuestas.buscar("cuentame un chiste"));
cierto("sin signos ni mayúsculas", respuestas.buscar("¿Cuántos años tienes?"));
cierto("con el nombre delante", respuestas.buscar("Merlín, ¿de dónde eres?"));
cierto("Whisper falla una letra", respuestas.buscar("como cambio tu vos"));
for (const q of ["¿cuántos años tiene mi padre?", "busca un chiste en internet sobre perros", "qué dice mi contrato", "cuál es la capital de Francia", "quién te creó ese archivo raro de ayer", "como cambio la contraseña de mi correo"]) igual(`no confunde: ${q}`, respuestas.buscar(q), null);
const r1 = respuestas.buscar("cuentame un chiste"), r2 = respuestas.buscar("cuentame un chiste");
cierto("varía la respuesta", r1 !== r2);

// ---------- Datos exactos ----------
const a = new Date(2026, 10, 9, 15, 5);
igual("hora", responderDato("¿Qué hora es?", a), "Son las 3 y 5 de la tarde.");
igual("una en punto", responderDato("qué hora es", new Date(2026, 10, 9, 13, 0)), "Es la 1 en punto de la tarde.");
igual("Whisper oye «qué horas»", responderDato("¿Qué horas?", a), "Son las 3 y 5 de la tarde.");
cierto("fecha", /2026/.test(responderDato("¿Qué día es hoy?", a)));
igual("hora en otro sitio no", responderDato("qué hora es en Tokio", a), null);

// ---------- Ciclo con un modelo simulado ----------
const tools = { schema: require("../src/tools").makeTools({ openExternal: async () => {}, openPath: async () => "" }).schema, run: async () => ({ pasajes: [{ ruta: "C:\\x.pdf", nombre: "x.pdf", loc: "", texto: "SECRETO-DOC" }] }) };
let llamadasModelo = 0, respuestaModelo = "París es la capital de Francia, y no acepta discusión.";
global.fetch = async (url, op) => {
  if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "local" }] }));
  llamadasModelo++;
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: respuestaModelo } }] })}\n\ndata: [DONE]\n\n`);
};
const preguntar = (q, h = []) => brain.ask(h, q, tools, {});
const registro = () => fs.readFileSync(path.join(datos, "aprendizaje.jsonl"), "utf8");

// Sin iniciar no se guarda nada
(async () => {
  await preguntar("cual es la capital de Italia");
  cierto("sin iniciar no crea registro", !fs.existsSync(path.join(datos, "aprendizaje.jsonl")));

  aprendizaje.iniciar(datos);
  const Q = "cual es la capital de Francia";
  const esperar = async () => { const f = Date.now; Date.now = () => f() + 100000; return () => { Date.now = f; }; };
  let base = Date.now(), reloj = base;
  Date.now = () => reloj;
  const pasar = (ms = 100000) => { reloj += ms; };

  llamadasModelo = 0;
  await preguntar(Q); pasar();
  await preguntar(Q); pasar();
  igual("dos veces: sigue preguntando al modelo", llamadasModelo, 2);
  await preguntar(Q); pasar();
  igual("la tercera aún la responde el modelo", llamadasModelo, 3);
  cierto("y queda aprendida", fs.readFileSync(respuestas.ruta(), "utf8").includes("capital de francia"));
  const aprendida = await preguntar(Q); pasar();
  igual("la cuarta no gasta modelo", llamadasModelo, 3);
  igual("con la misma respuesta", aprendida, respuestaModelo);

  // Corrección
  const h = [];
  await brain.ask(h, Q, tools, {});
  igual("«eso está mal» pide la correcta", await brain.ask(h, "No, eso está mal.", tools, {}), F.pidoCorreccion);
  cierto("y olvida la mala", !fs.readFileSync(respuestas.ruta(), "utf8").includes("no acepta discusión"));
  igual("guarda la corrección", await brain.ask(h, "Es París, y punto.", tools, {}), F.corregido);
  igual("sobre la pregunta correcta", await preguntar(Q), "Es París, y punto.");
  pasar();

  // Lo que el usuario responde sin dar un dato no se memoriza
  await preguntar("cuál es el río más largo del mundo"); pasar(1000);
  await preguntar("eso está mal");
  const antes = respuestas.total();
  await preguntar("no sé");
  igual("«no sé» no se guarda como respuesta", respuestas.total(), antes);
  pasar(400000);

  // Corrección directa
  respuestaModelo = "El Everest, sin duda alguna.";
  await preguntar("cuál es el monte más alto del mundo"); pasar(1000);
  igual("corrección en la misma frase", await preguntar("No, la respuesta es el Everest, en el Himalaya."), F.corregido);
  igual("se aplica", await preguntar("cuál es el monte más alto del mundo"), "El Everest, en el Himalaya.");
  pasar(400000);

  // Enseñar
  igual("enseñar", await preguntar("Cuando te pregunte cómo se llama mi perro, responde que se llama Toby."), F.ensenado);
  igual("lo enseñado responde", await preguntar("¿Cómo se llama mi perro?"), "Se llama Toby.");
  igual("no anota secretos enseñados", await preguntar("Cuando te pregunte cuál es mi clave, responde que es 1234"), personalidad.FRASES_MEMORIA.secreto);

  // Aprobación: dos veces bastan
  respuestaModelo = "Es el océano Pacífico, de lejos el mayor.";
  await preguntar("cuál es el océano más grande"); pasar();
  await preguntar("cuál es el océano más grande"); pasar(1000);
  cierto("aprobar responde", aprendizaje.APROBACIONES.includes(await preguntar("Correcto.")));
  cierto("con aprobación se aprende antes", fs.readFileSync(respuestas.ruta(), "utf8").includes("oceano mas grande"));
  pasar(400000);

  // Lo que no debe memorizarse
  respuestaModelo = "Hoy está a novecientos pesos, más o menos.";
  llamadasModelo = 0;
  for (let i = 0; i < 4; i++) { await preguntar("a cuánto está el dólar hoy"); pasar(); }
  igual("lo que cambia nunca se memoriza", llamadasModelo, 4);
  respuestaModelo = "Tu perro es un labrador muy simpático.";
  llamadasModelo = 0;
  for (let i = 0; i < 4; i++) { await preguntar("qué raza es mi perro"); pasar(); }
  igual("lo personal tampoco", llamadasModelo, 4);

  // Preguntar lo mismo enseguida es señal de que no sirvió
  respuestaModelo = "Es Canberra, aunque casi nadie lo acierta.";
  llamadasModelo = 0;
  await preguntar("cuál es la capital de Australia"); pasar(5000);
  await preguntar("cuál es la capital de Australia"); pasar(100000);
  await preguntar("cuál es la capital de Australia"); pasar(100000);
  await preguntar("cuál es la capital de Australia"); pasar();
  igual("repetida enseguida no se aprende", llamadasModelo, 4);

  // Documentos: ni pregunta ni respuesta en el registro
  respuestaModelo = "Tu contrato dice que SECRETO-RESPUESTA es la renta.";
  const hd = [];
  await brain.ask(hd, "¿Qué dice mi contrato sobre la renta tan rara?", tools, {}); pasar(1000);
  cierto("documentos marcados privados", hd.at(-1).privado);
  cierto("no quedan en el registro", !registro().includes("SECRETO") && !registro().includes("renta tan rara"));
  igual("no se corrige sobre documentos", await brain.ask(hd, "Eso está mal", tools, {}), F.privado);
  pasar(400000);

  // Secretos
  respuestaModelo = "Eso no lo sé, la verdad, lo siento mucho.";
  await preguntar("mi contraseña del banco es gatito123 no la olvides"); pasar();
  cierto("los secretos no quedan en el registro", !registro().includes("gatito123"));

  // Datos del usuario
  cierto("se presenta", /Ana/.test(await preguntar("Me llamo Ana.")));
  cierto("queda anotado", personalidad.listar().includes("Me llamo Ana"));
  await preguntar("Vivo en Santiago de Chile.");
  cierto("dónde vive", personalidad.listar().includes("Vivo en Santiago de Chile"));
  await preguntar("Mi color favorito es el verde.");
  cierto("favoritos", personalidad.listar().some((x) => /color favorito es el verde/i.test(x)));
  llamadasModelo = 0;
  await preguntar("¿Me gusta el café?");
  igual("una pregunta no se anota", personalidad.listar().some((x) => /caf/.test(x)), false);
  igual("va al modelo", llamadasModelo, 1);
  await preguntar("Trabajo en una clave de seguridad.");
  igual("no anota lo que parece secreto", personalidad.listar().some((x) => /clave/.test(x)), false);

  // Cuánto ha aprendido
  cierto("resumen", /Llevamos \d+ preguntas/.test(await preguntar("¿Cuánto has aprendido?")));

  // Errores no se memorizan
  respuestaModelo = "";
  llamadasModelo = 0;
  for (let i = 0; i < 4; i++) { await preguntar("cuál es la raíz de nueve mil"); pasar(); }
  igual("una respuesta vacía no se memoriza", llamadasModelo, 4);

  // Informe y reinicio
  aprendizaje.escribirInforme();
  const inf = fs.readFileSync(aprendizaje.rutaInforme(), "utf8");
  cierto("informe con cifras", /Preguntas respondidas: \d+/.test(inf));
  cierto("informe sin privados", !inf.includes("renta tan rara") && !inf.includes("gatito123"));
  cierto("informe con lo que falta", inf.includes("capital de Australia"));
  aprendizaje.iniciar(datos);
  cierto("recuerda tras reiniciar", /Preguntas respondidas: [1-9]/.test((aprendizaje.escribirInforme(), fs.readFileSync(aprendizaje.rutaInforme(), "utf8"))));

  // Lo interrumpen
  const hc = [{ role: "user", content: "x" }, { role: "assistant", content: "Una respuesta larga y completa." }];
  brain.respuestaCortada(hc, "Una respuesta");
  cierto("guarda hasta dónde se oyó", hc[1].content.startsWith("Una respuesta…") && !hc[1].content.includes("completa"));

  console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(mal ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
