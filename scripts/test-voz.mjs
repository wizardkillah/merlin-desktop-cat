// Pruebas de la parte pura de la voz: node --no-warnings scripts/test-voz.mjs
import { readFileSync } from "node:fs";
import { fragmentar, agrupar, suavizarR, recortarSilencio, PERFILES, paraVoz, sinMiau, pausaTras, ritmoDe, variante, claveFrase, esMuletillaSuelta, FRASES, FRASES_PREGRABADAS, leerWav, saludoHablado, duracionCreible } from "../src/renderer/voz-nucleo.js";
import brain from "../src/brain.js";

let ok = 0, mal = 0;
const prueba = (n, c, extra = "") => { if (c) { ok++; console.log("  ok ", n); } else { mal++; console.log("  MAL", n, extra); } };
const igual = (n, real, esperado) => prueba(n, real === esperado, `→ ${JSON.stringify(real)}`);

console.log("Frases");
const f = fragmentar("¡Miau! El plazo es indefinido. ¿Algo más?");
prueba("corta por frases y conserva los signos", f.length === 3 && f[0] === "¡Miau!" && f[2] === "¿Algo más?", JSON.stringify(f));
const largo = fragmentar("palabra, ".repeat(100));
prueba("ninguna frase se pasa del máximo", largo.length > 1 && largo.every((x) => x.length <= 220));
prueba("no pierde palabras al cortar", largo.join(" ").match(/palabra/g).length === 100);
prueba("texto vacío no genera frases", fragmentar("   ").length === 0);
const n = fragmentar("Son 80.000 pesos al mes. Y nada más");
prueba("un punto de miles no parte la frase", n.length === 2 && n[0] === "Son 80.000 pesos al mes." && n[1] === "Y nada más", JSON.stringify(n));

console.log("Pronunciación");
igual("el signo $ son pesos, no dólares", paraVoz("La renta es de $80.000."), "La renta es de 80.000 pesos.");
igual("no duplica «pesos»", paraVoz("Son $80.000 pesos"), "Son 80.000 pesos");
igual("USD va detrás y en español", paraVoz("Cuesta USD 6400 al mes"), "Cuesta 6400 dólares al mes");
igual("CLP pegado al número", paraVoz("renta de CLP80.000"), "renta de 80.000 pesos");
igual("OCR por letras", paraVoz("leído con OCR"), "leído con o ce erre");
igual("no toca palabras que contienen la sigla", paraVoz("WORD y wordpress"), "WORD y wordpress");
igual("nombre de archivo sin guiones bajos", paraVoz("Mira Contrato_Arriendo_original.pdf"), "Mira Contrato Arriendo original.pdf");
igual("guion bajo escapado", paraVoz("IMBERT\\_MODELO"), "IMBERT MODELO");
igual("sin URLs ni markdown", paraVoz("Mira **esto** en [la web](https://a.com) https://b.com"), "Mira esto en la web");
igual("los documentos son del usuario", paraVoz("Según mis notas y mi contrato"), "Según tus notas y tu contrato");
igual("sin emojis", paraVoz("Listo ✨🎩"), "Listo");

console.log("Miau");
igual("quita el miau inicial", sinMiau("¡Miau! Son 80 pesos."), "Son 80 pesos.");
igual("quita el miau final", sinMiau("Son 80 pesos, miau."), "Son 80 pesos.");
igual("no toca lo demás", sinMiau("Mira, son 80 pesos."), "Mira, son 80 pesos.");

console.log("Frases ya dichas");
prueba("«mis» y «tus» son la misma frase", claveFrase("Según mis notas, son 80.") === claveFrase("Según tus notas, son 80."));
prueba("con y sin miau son la misma frase", claveFrase("Son 80, miau.") === claveFrase("Son 80."));
prueba("con y sin comillas son la misma frase", claveFrase("«Son 80 pesos.»") === claveFrase("Son 80 pesos."));
prueba("frases distintas siguen siendo distintas", claveFrase("Son 80.") !== claveFrase("Son 90."));
prueba("detecta una exclamación suelta", esMuletillaSuelta("¡Claro!") && esMuletillaSuelta("Mira.") && esMuletillaSuelta("Miau."));
prueba("no confunde una frase normal", !esMuletillaSuelta("Mira, son 80 pesos."));

console.log("Fluidez y R");
const g = agrupar(["¡Hola!", "Soy Merlín.", "x".repeat(165), "Fin."]);
prueba("une frases cortas", g[0] === "¡Hola! Soy Merlín.", JSON.stringify(g));
prueba("no pasa del máximo al unir", g.every((x) => x.length <= 170) && g.length === 2, g.map((x) => x.length).join());
prueba("no pierde frases", g.join(" ").includes("Fin."));
const mapa = JSON.parse(readFileSync(new URL("../assets/voces/es_MX-claude-high.onnx.json", import.meta.url))).phoneme_id_map;
prueba("el modelo tiene las dos R", mapa["r"]?.length === 1 && mapa["ɾ"]?.length === 1);
const conR = suavizarR([1, mapa["r"][0], 0, mapa["a"][0]], mapa);
prueba("la R fuerte pasa a suave", conR[1] === mapa["ɾ"][0] && conR[3] === mapa["a"][0], JSON.stringify(conR));
prueba("sin cambios si el mapa no la tiene", suavizarR([1, 2], { x: [1] }).join() === "1,2");
const pulso = new Float32Array(22050);
for (let i = 5000; i < 10000; i++) pulso[i] = 0.5;
const rec = recortarSilencio(pulso, 22050);
prueba("recorta el silencio de los bordes", rec.length < 7000 && rec.length > 5000, String(rec.length));
prueba("suaviza el inicio y el final", Math.abs(rec[0]) < 0.01 && Math.abs(rec.at(-1)) < 0.1);
prueba("el original no cambia", pulso[5000] === 0.5);
const mudo = new Float32Array(100);
prueba("un audio mudo no falla", recortarSilencio(mudo, 22050).length === 100);
prueba("hay perfil natural sin efectos", PERFILES.natural.tono === 1 && PERFILES.natural.ambiente === 0);
prueba("los otros perfiles son más graves", PERFILES.gato.tono < 1 && PERFILES.hechicero.tono < PERFILES.gato.tono);
prueba("el perfil Merlín es grave, ágil y sin efectos", PERFILES.merlin.tono < PERFILES.hechicero.tono && PERFILES.merlin.ritmo < 1 && PERFILES.merlin.ambiente === 0 && PERFILES.merlin.cuerpo === 0);

console.log("Pausas y ritmo");
const fijo = () => 0.5;
prueba("una pregunta pausa más que una exclamación", pausaTras("¿Qué tal?", fijo) > pausaTras("¡Hola!", fijo));
prueba("un corte a media frase pausa poco", pausaTras("palabra", fijo) < 0.1);
const pausas = new Set(Array.from({ length: 20 }, () => pausaTras("Listo.")));
prueba("las pausas no son siempre iguales", pausas.size > 5);
prueba("lo largo se dice con más calma", ritmoDe("x".repeat(160), fijo) > ritmoDe("Hola.", fijo));
const ritmos = Array.from({ length: 200 }, () => ritmoDe("x".repeat(160)));
prueba("el ritmo se queda en un margen natural", ritmos.every((r) => r > 0.95 && r < 1.1));

console.log("Variantes");
const seguidas = Array.from({ length: 50 }, () => variante(FRASES.revisando));
prueba("nunca repite dos veces seguidas", seguidas.every((x, i) => i === 0 || x !== seguidas[i - 1]));
prueba("usa varias", new Set(seguidas).size === FRASES.revisando.length);

console.log("Frases pregrabadas");
const claves = FRASES_PREGRABADAS.map(claveFrase);
prueba("cada frase tiene su propia clave", claves.every(Boolean) && new Set(claves).size === claves.length);
prueba("se reconocen tal como llegan a la voz", FRASES_PREGRABADAS.every((x) => claveFrase(paraVoz(x)) === claveFrase(x)));
prueba("incluye todos los avisos de espera", [...FRASES.revisando, ...FRASES.pensando, ...FRASES.sigo].every((x) => FRASES_PREGRABADAS.includes(x)));
const principal = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
prueba("coincide con la frase de «Olvidar la conversación»", FRASES_PREGRABADAS.includes("Listo, ya lo olvidé todo.") && principal.includes('send("say", "Listo, ya lo olvidé todo.'));
const todas = [...FRASES_PREGRABADAS, ...brain.RESPUESTAS_FIJAS];
const clavesTodas = todas.map(claveFrase);
prueba("sin frases repetidas en toda la biblioteca", new Set(clavesTodas).size === clavesTodas.length, clavesTodas.filter((c, i) => clavesTodas.indexOf(c) !== i).join());
prueba("todas se reconocen al llegar a la voz", todas.every((x) => claveFrase(paraVoz(x)) === claveFrase(x)));
// app.js suelta el texto a la voz al llegar a 150 caracteres: una frase más larga se partiría y ya no sonaría grabada
prueba("todas caben en un solo envío a la voz", todas.every((x) => paraVoz(x).length < 150), todas.filter((x) => paraVoz(x).length >= 150).join(" | "));
igual("el comando de LM Studio no se lee en voz alta", paraVoz(brain.SIN_LMSTUDIO), "Miau... no encuentro LM Studio. ¿Está encendido el servidor?");
igual("del saludo solo se dice la presentación", paraVoz(saludoHablado(FRASES.saludo[0].replace("{n}", "Merlín"))), "Hola, soy Merlín, tu gato brujo de escritorio.");
prueba("el saludo no dice «más o menos»", !FRASES.saludo.some((s) => /m[aá]s o menos/i.test(s)));
prueba("el saludo hablado está en la biblioteca", FRASES.saludo.every((s) => clavesTodas.includes(claveFrase(saludoHablado(s.replace("{n}", "Merlín"))))));

function crearWav(muestras, { extra = 0, canales = 1, bits = 16 } = {}) {
  const b = Buffer.alloc(12 + 24 + (extra ? 8 + extra + (extra % 2) : 0) + 8 + muestras.length * 2);
  let o = 0;
  b.write("RIFF", 0); b.writeUInt32LE(b.length - 8, 4); b.write("WAVE", 8); o = 12;
  b.write("fmt ", o); b.writeUInt32LE(16, o + 4); b.writeUInt16LE(1, o + 8); b.writeUInt16LE(canales, o + 10); b.writeUInt32LE(24000, o + 12);
  b.writeUInt32LE(48000, o + 16); b.writeUInt16LE(2, o + 20); b.writeUInt16LE(bits, o + 22); o += 24;
  if (extra) { b.write("LIST", o); b.writeUInt32LE(extra, o + 4); o += 8 + extra + (extra % 2); }
  b.write("data", o); b.writeUInt32LE(muestras.length * 2, o + 4); o += 8;
  muestras.forEach((m, i) => b.writeInt16LE(m, o + i * 2));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
prueba("acepta la duración de una toma normal", duracionCreible("Claro, déjame revisar mis pergaminos.", 2.65));
prueba("detecta una toma cortada", !duracionCreible("Buena pregunta, dame un momento.", 1.32));
prueba("detecta una toma a la que le falta el principio", !duracionCreible("Silencio total por aquí. Prueba otra vez.", 2.08));
prueba("detecta una toma demasiado larga", !duracionCreible("Hola.", 3));
const wav = leerWav(crearWav([0, 16384, -32768]));
prueba("lee frecuencia y muestras de un WAV", wav.frecuencia === 24000 && wav.audio.length === 3 && wav.audio[1] === 0.5 && wav.audio[2] === -1);
prueba("salta bloques extra de tamaño impar", leerWav(crearWav([16384], { extra: 3 })).audio[0] === 0.5);
const rechaza = (fn) => { try { fn(); return false; } catch { return true; } };
prueba("rechaza lo que no es WAV", rechaza(() => leerWav(new TextEncoder().encode("esto no es un wav").buffer)));
prueba("rechaza un WAV estéreo", rechaza(() => leerWav(crearWav([0, 0], { canales: 2 }))));
prueba("rechaza un WAV sin audio", rechaza(() => leerWav(crearWav([]))));

console.log(`\n${ok} correctas, ${mal} fallidas`);
process.exit(mal ? 1 : 0);
