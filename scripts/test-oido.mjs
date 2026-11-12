// Prueba el núcleo del oído sin micrófono: node --no-warnings scripts/test-oido.mjs
import { crearSegmentador, detectarInvocacion, esOrdenCallar, esEco, esMuletilla, limpiarTranscripcion, crearSelectorOido } from "../src/renderer/oido-nucleo.js";

let ok = 0, mal = 0;
const igual = (nombre, real, esperado) => {
  const r = JSON.stringify(real), e = JSON.stringify(esperado);
  if (r === e) { ok++; return; }
  mal++; console.log(`✘ ${nombre}\n   real:     ${r}\n   esperado: ${e}`);
};

// ---------- Invocación ----------
const inv = (t) => { const d = detectarInvocacion(t); return d.invocado ? d.resto : null; };
igual("nombre y pregunta", inv("Merlín, ¿qué hora es?"), "¿qué hora es?");
igual("sin acento", inv("merlin que hora es"), "que hora es");
igual("con saludo", inv("Oye, Merlín, abre mi currículum."), "abre mi currículum.");
igual("hola merlin", inv("Hola Merlín, ¿cómo estás?"), "¿cómo estás?");
igual("al final", inv("¿Qué hora es, Merlín?"), "¿Qué hora es?");
igual("en medio", inv("Dime, Merlín, ¿qué tiempo hace?"), "Dime ¿qué tiempo hace?");
igual("solo el nombre", inv("Merlín."), "");
igual("solo el nombre con saludo", inv("Oye Merlín"), "");
igual("Whisper oye Marlin", inv("Marlin, ¿qué hora es?"), "¿qué hora es?");
igual("Whisper oye Merlí", inv("Merlí, pon música."), "pon música.");
igual("Whisper oye Berlín con pausa", inv("Berlín, ¿qué hora es?"), "¿qué hora es?");
igual("Berlín de verdad", inv("Viajo a Berlín en marzo."), null);
igual("Berlín sin pausa al inicio", inv("Berlín es una ciudad bonita."), null);
igual("otra conversación", inv("Mañana tengo que ir al médico."), null);
igual("palabra parecida sin relación", inv("El martes vamos."), null);
igual("vacío", inv(""), null);
igual("«Oye» oído como «Hoy»", inv("Hoy Merlín, abre mi currículum."), "abre mi currículum.");
igual("«Oye Merlín» oído como «Hoy en Berlin»", inv("Hoy en Berlin, abre mi currículum."), "abre mi currículum.");
igual("«Oye Merlín» oído como «Hoy en Merlin»", inv("Hoy en Merlin, abre mi currículum."), "abre mi currículum.");
igual("«Oye Merlín» oído junto", inv("Hoy emerlin, abre mi currículum."), "abre mi currículum.");
igual("Whisper oye Marin", inv("Marin, busca el precio del dólar."), "busca el precio del dólar.");
igual("hoy, sin llamarlo", inv("Hoy, me pasas la sal por favor."), null);
igual("hoy en otro sitio", inv("Hoy en Berlín hace frío."), null);
igual("Marín en una frase", inv("Pregúntale a Marín mañana."), null);

// ---------- Limpieza de lo que escribe Whisper ----------
igual("frase normal", limpiarTranscripcion("Merlin, ¿qué hora es?"), "Merlin, ¿qué hora es?");
igual("silencio", limpiarTranscripcion("[BLANK_AUDIO]"), "");
igual("música", limpiarTranscripcion("(música)"), "");
igual("gracias inventado", limpiarTranscripcion("¡Gracias por ver!"), "");
igual("bucle", limpiarTranscripcion("Merlin, qué hora es? Merlin, qué hora es? Merlin, qué hora es?"), "Merlin, qué hora es?");
igual("bucle cortado", limpiarTranscripcion("Hola Merlin, ¿cómo estás hoy? Hola Merlin, ¿cómo estás hoy? Hola Merlin,"), "Hola Merlin, ¿cómo estás hoy?");
igual("nombre en bucle", limpiarTranscripcion("Merlin Merlin Merlin Merlin"), "Merlin");
igual("no quita lo que no es bucle", limpiarTranscripcion("la casa de la casa grande"), "la casa de la casa grande");

// ---------- Orden de callar ----------
igual("cállate", esOrdenCallar("Cállate."), true);
igual("para ya", esOrdenCallar("para ya"), true);
for (const v of ["callate.", "Cayate", "cajate.", "caiate.", "quayate.", "ayate.", "Calla.", "Silencio.", "Cancela.", "Basta ya."]) igual(`variante ${v}`, esOrdenCallar(v), true);
igual("una respuesta con palabras comunes no es eco", esEco("Es Santiago, la capital.", "¿Cuál es la respuesta correcta? Hola, soy Merlín.", 0.5), false);
for (const v of ["¿Qué hora es?", "Cállate la boca y dime la hora", "Cancela la reunión"]) igual(`no es orden: ${v}`, esOrdenCallar(v), false);
igual("para qué sirve", esOrdenCallar("¿Para qué sirve esto?"), false);

// ---------- Eco de su propia voz ----------
const dicho = "Soy Merlín, un gato brujo que vive en tu escritorio.";
igual("eco literal", esEco("Merlín, un gato brujo que vive", dicho), true);
igual("pregunta nueva", esEco("Merlín, ¿qué dijiste de los perros?", dicho), false);
igual("palabra corta suelta del eco", esEco("gato brujo", dicho), true);
igual("sin nada dicho", esEco("hola qué tal", ""), false);
igual("eco mal transcrito, con umbral estricto", esEco("Hoy Merlín, un gato que vive en la casa", dicho, 0.5), true);
igual("una pregunta nueva no es eco", esEco("Merlín, cuéntame algo sobre los perros", dicho, 0.5), false);

// ---------- Muletillas ----------
for (const m of ["Ajá.", "mmm", "Ok.", "vale", "Ya.", "sí"]) igual(`muletilla ${m}`, esMuletilla(m), true);
for (const m of ["Sí, abre el archivo", "ok busca eso", "¿Y el plazo?"]) igual(`no es muletilla: ${m}`, esMuletilla(m), false);

// ---------- Detector de voz ----------
const F = 16000, B = 2048;
const silencio = () => new Float32Array(B).fill(0.0005);
const voz = (a = 0.08) => Float32Array.from({ length: B }, (_, i) => Math.sin(i / 8) * a);
function correr(seg, guion) {
  const ev = [];
  for (const [bloque, n, factor] of guion) for (let i = 0; i < n; i++) { const r = seg.alimentar(bloque(), factor); if (r) ev.push(r); }
  return ev;
}
const seg128 = (ms) => Math.ceil(ms / (B / F * 1000));

let ev = correr(crearSegmentador(), [[silencio, 20], [voz, seg128(1500)], [silencio, seg128(1100)]]);
igual("frase normal: inicio y fin", ev.map((e) => e.tipo), ["inicio", "fin"]);
const dur = ev[1].audio.length / F;
igual("guarda la voz y el audio previo", dur > 1.5 && dur < 3.2, true);
igual("incluye audio anterior a la voz", ev[1].audio[0] !== undefined && Math.abs(ev[1].audio[0]) < 0.01, true);

ev = correr(crearSegmentador(), [[silencio, 20], [voz, 1], [silencio, 20]]);
igual("un golpe suelto no es voz", ev.length, 0);

ev = correr(crearSegmentador(), [[silencio, 10], [voz, 3], [silencio, seg128(500)], [voz, 3], [silencio, seg128(1100)]]);
igual("una pausa corta no parte la frase", ev.map((e) => e.tipo), ["inicio", "fin"]);

ev = correr(crearSegmentador(), [[silencio, 20], [() => voz(0.02), 10, 2.5], [silencio, 5]]);
igual("mientras habla Merlín hace falta más volumen", ev.length, 0);
ev = correr(crearSegmentador(), [[silencio, 20], [() => voz(0.2), 10, 2.5], [silencio, seg128(1100)]]);
igual("pero una voz fuerte se oye igual", ev.map((e) => e.tipo), ["inicio", "fin"]);

const largo = crearSegmentador();
ev = correr(largo, [[silencio, 10], [voz, seg128(21000)]]);
igual("corta a los 20 s", ev.filter((e) => e.tipo === "fin").length, 1);
igual("aprende el ruido constante", largo.ruido() > 0.01, true);

const conMusica = crearSegmentador();
ev = [];
for (let i = 0; i < 10; i++) conMusica.alimentar(silencio());
for (let i = 0; i < seg128(7000); i++) { const r = conMusica.alimentar(voz(), 1, 6000); if (r) ev.push(r.tipo); }
igual("con música la frase se corta a los 6 s", ev.slice(0, 2), ["inicio", "fin"]);

// ---------- Tras una respuesta larga sigue oyendo el llamado ----------
// Antes el eco de su propia voz se aprendía como ruido de fondo: el umbral quedaba alto y no oía «Merlín» nunca más
{
  const bloqueRms = (rms) => { const b = new Float32Array(2048); for (let i = 0; i < b.length; i++) b[i] = (i % 2 ? 1 : -1) * rms; return b; };
  for (const [nombre, eco] of [["eco suave", 0.025], ["eco fuerte", 0.06]]) {
    const s = crearSegmentador();
    for (let i = 0; i < 20; i++) s.alimentar(bloqueRms(0.003), 1);
    for (let i = 0; i < 25 * 7.8; i++) s.alimentar(bloqueRms(eco), 2.5); // 25 s hablando Merlín
    for (let i = 0; i < 8; i++) s.alimentar(bloqueRms(0.003), 2.5);       // su segundo de descanso
    let oyo = false;
    for (let i = 0; i < 6; i++) if (s.alimentar(bloqueRms(0.04), 1)?.tipo === "inicio") oyo = true;
    igual(`tras 25 s de respuesta con ${nombre}, oye el llamado`, oyo, true);
    igual(`y el eco no quedó como ruido (${nombre})`, s.ruido() < 0.006, true);
  }
  // Una voz que no llega al umbral no debe subirlo: antes se reforzaba sola y no oía nunca
  const s = crearSegmentador();
  for (let i = 0; i < 300; i++) s.alimentar(bloqueRms(i % 15 < 6 ? 0.011 : 0.003), 1);
  igual("una voz baja no sube el ruido de fondo", s.ruido() < 0.006, true);
}

// ---------- Qué Whisper usar ----------
// Antes un solo fallo de whisper.cpp lo apagaba hasta cerrar la app, y todo pasaba al de WebAssembly, que reconoce peor
let reloj = 0;
const sel = crearSelectorOido({ instalado: true, ahora: () => reloj });
igual("empieza con whisper.cpp", sel.usarNativo(), true);
igual("un fallo suelto no lo apaga", [sel.fallo(), sel.usarNativo()], [false, true]);
sel.exito();
igual("un acierto reinicia la cuenta", [sel.fallo(), sel.fallo(), sel.usarNativo()], [false, false, true]);
igual("tres seguidos: descansa", [sel.fallo(), sel.usarNativo()], [true, false]);
reloj += 119000;
igual("sigue descansando antes de 2 min", sel.usarNativo(), false);
reloj += 1000;
igual("a los 2 min lo vuelve a intentar", sel.usarNativo(), true);
igual("tras descansar, otro fallo suelto no lo apaga", [sel.fallo(), sel.usarNativo()], [false, true]);
igual("sin instalar, nunca", crearSelectorOido({ instalado: false }).usarNativo(), false);

console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
process.exit(mal ? 1 : 0);
