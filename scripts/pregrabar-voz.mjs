// Graba con la voz de Merlín de Voice Studio las frases fijas del asistente: npm run voz:pregrabar
// Voice Studio solo hace falta aquí: el asistente reproduce los archivos sin conectarse a nada.
// Tarda varios minutos por frase en CPU. Si se corta, al volver a lanzarlo sigue por donde iba.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import brain from "../src/brain.js";
import { FRASES_PREGRABADAS as FRASES_INTERFAZ, claveFrase, duracionCreible, leerWav, paraVoz } from "../src/renderer/voz-nucleo.js";

const FRASES_PREGRABADAS = [...FRASES_INTERFAZ, ...brain.RESPUESTAS_FIJAS];

const PERFIL = process.env.MERLIN_VOZ_PERFIL || "7912a8c5";
const API = process.env.VOICE_STUDIO_URL || "http://127.0.0.1:3900";
const AJUSTES = { model: "omnivoice", voice: PERFIL, language: "es", response_format: "wav", seed: 42, num_step: 16 };

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "voces", "merlin");
const RUTA_MANIFIESTO = join(DIR, "manifiesto.json");

// Con http y no fetch: fetch se rinde a los 5 minutos sin respuesta, y en CPU una frase puede tardar más
function pedir(ruta, cuerpo) {
  return new Promise((resuelve, rechaza) => {
    const datos = cuerpo ? Buffer.from(JSON.stringify(cuerpo)) : null;
    const req = http.request(API + ruta, { method: datos ? "POST" : "GET", headers: datos ? { "Content-Type": "application/json", "Content-Length": datos.length } : {} }, (res) => {
      const trozos = [];
      res.on("data", (t) => trozos.push(t));
      res.on("end", () => {
        const todo = Buffer.concat(trozos);
        if (res.statusCode === 200) resuelve(todo);
        else rechaza(new Error(`Voice Studio respondió ${res.statusCode}: ${todo.toString("utf8").slice(0, 300)}`));
      });
    });
    req.on("error", rechaza);
    req.end(datos);
  });
}

function guardar(ruta, datos) {
  writeFileSync(ruta + ".tmp", datos);
  renameSync(ruta + ".tmp", ruta); // un corte a medias nunca deja un archivo roto
}

try {
  await pedir("/health");
} catch (e) {
  console.error(`No puedo conectar con Voice Studio en ${API}. ¿Está abierto? (${e.message})`);
  process.exit(1);
}

mkdirSync(DIR, { recursive: true });
const anterior = existsSync(RUTA_MANIFIESTO) ? JSON.parse(readFileSync(RUTA_MANIFIESTO, "utf8")).frases : {};
const frases = {};
const escribirManifiesto = () => guardar(RUTA_MANIFIESTO, JSON.stringify({ perfil: PERFIL, frases }, null, 2) + "\n");

const MAX_INTENTOS = 3;
// Para regrabar una toma que suena mal aunque dure lo normal: npm run voz:pregrabar -- --rehacer="texto de la frase"
// Si la nueva toma tampoco convence, otra semilla da otra distinta: --semilla=60
const REHACER = process.argv.filter((a) => a.startsWith("--rehacer=")).map((a) => a.slice("--rehacer=".length));
const SEMILLA_REHACER = Number(process.argv.find((a) => a.startsWith("--semilla="))?.slice("--semilla=".length) ?? AJUSTES.seed + 10);
const fallidas = [];
let hechas = 0;
for (const [i, frase] of FRASES_PREGRABADAS.entries()) {
  const texto = paraVoz(frase), clave = claveFrase(frase);
  const previa = anterior[clave];
  const rehacer = REHACER.includes(texto);
  if (!rehacer && previa?.texto === texto && existsSync(join(DIR, previa.archivo)) && duracionCreible(texto, previa.segundos)) {
    frases[clave] = previa;
    console.log(`[${i + 1}/${FRASES_PREGRABADAS.length}] ya estaba: ${texto}`);
    continue;
  }
  const t0 = Date.now();
  let toma = null;
  for (let intento = 0; intento < MAX_INTENTOS && !toma; intento++) { // otra semilla da otra toma
    const semilla = (rehacer ? SEMILLA_REHACER : AJUSTES.seed) + intento; // la misma semilla repetiría la misma toma
    const wav = await pedir("/v1/audio/speech", { ...AJUSTES, seed: semilla, input: texto });
    const { audio, frecuencia } = leerWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length)); // comprueba que el audio se podrá reproducir
    const segundos = +(audio.length / frecuencia).toFixed(2);
    if (duracionCreible(texto, segundos)) toma = { wav, segundos };
    else console.log(`    toma descartada (${segundos} s, semilla ${semilla}): ${texto}`);
  }
  if (!toma) { // sin audio la dice Piper: mejor eso que una toma rota
    fallidas.push(texto);
    continue;
  }
  const archivo = createHash("sha1").update(texto).digest("hex").slice(0, 12) + ".wav";
  guardar(join(DIR, archivo), toma.wav);
  frases[clave] = { archivo, texto, segundos: toma.segundos };
  escribirManifiesto();
  hechas++;
  console.log(`[${i + 1}/${FRASES_PREGRABADAS.length}] ${Math.round((Date.now() - t0) / 1000)} s → ${toma.segundos} s de audio: ${texto}`);
}
escribirManifiesto();
console.log(`Listo: ${hechas} grabadas, ${FRASES_PREGRABADAS.length - hechas - fallidas.length} ya estaban, ${fallidas.length} sin toma válida. En ${DIR}`);
for (const f of fallidas) console.log(`  sin toma válida: ${f}`);
