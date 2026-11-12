// Prueba whisper.cpp con el binario real: node --no-warnings scripts/test-oido-nativo.js
const fs = require("fs"), path = require("path");
const nativo = require("../src/oido-nativo");

let ok = 0, mal = 0;
const igual = (nombre, real, esperado) => {
  const r = JSON.stringify(real), e = JSON.stringify(esperado);
  if (r === e) { ok++; return; }
  mal++; console.log(`✘ ${nombre}\n   real:     ${r}\n   esperado: ${e}`);
};

// Contexto: nunca por debajo del mínimo que evita los bucles, y suficiente para la frase
igual("frase corta usa el mínimo", nativo.contextoDe(2), 500);
igual("cubre una frase larga", nativo.contextoDe(14.2), 800);
igual("no pasa del máximo", nativo.contextoDe(40), 1500);

// Tiempo límite: 12 s para frases cortas, más para las largas (con Gemma ocupando la CPU), nunca más de 30 s
igual("límite de una frase corta", nativo.limiteDe(3), 14100);
igual("límite de la frase más larga (20 s)", nativo.limiteDe(20), 26000);
igual("límite máximo", nativo.limiteDe(60), 30000);

// WAV de 16 bits, sin saturar
const wav = nativo.aWav(Float32Array.from([0, 1, -1, 2]));
igual("cabecera", wav.toString("latin1", 0, 4), "RIFF");
igual("recorta lo que satura", [wav.readInt16LE(46), wav.readInt16LE(48), wav.readInt16LE(50)], [32767, -32767, 32767]);

(async () => {
  igual("binario instalado", nativo.disponible(), true);
  // prueba.wav: «Hola gatito, busca en internet qué tiempo hace mañana en Barcelona.»
  const b = fs.readFileSync(path.join(__dirname, "prueba.wav"));
  let o = 12; while (b.toString("latin1", o, o + 4) !== "data") o += 8 + b.readUInt32LE(o + 4);
  const n = b.readUInt32LE(o + 4) / 2, audio = new Float32Array(n);
  for (let i = 0; i < n; i++) audio[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
  const r = await nativo.transcribir(audio);
  console.log(`  whisper.cpp: ${r.ms} ms «${r.text}»`);
  igual("transcribe bien", /gatito.*internet.*Barcelona/i.test(r.text || ""), true);

  // Si el binario no sirve, avisa sin lanzar: la app pasa a WebAssembly
  const roto = await new Promise((res) => {
    process.env.WHISPER_NATIVO_DIR = path.join(__dirname, "no-existe");
    delete require.cache[require.resolve("../src/oido-nativo")];
    require("../src/oido-nativo").transcribir(audio).then(res);
  });
  igual("sin binario devuelve error", !!roto.error, true);

  console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
  process.exit(mal ? 1 : 0);
})();
