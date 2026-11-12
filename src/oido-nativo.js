// Oído nativo: whisper.cpp en assets/whisper. Mucho más rápido que WebAssembly porque procesa solo el audio
// de la frase, no 30 s fijos. El audio entra por stdin: no se escribe nada en disco y nada sale del PC.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const CARPETA = process.env.WHISPER_NATIVO_DIR || path.join(__dirname, "..", "assets", "whisper");
const BINARIO = path.join(CARPETA, "whisper-cli.exe"), MODELO = path.join(CARPETA, "ggml-base.bin");
const FRECUENCIA = 16000, HILOS = 4;
// Tiempo límite según lo que dura la frase: con Gemma generando a la vez, la CPU se reparte y una frase larga
// puede pasar de 12 s. Medido sin carga: 6,6 s de audio en 1,8 s y 26 s en 3,7 s.
const limiteDe = (segundos) => Math.min(30000, 12000 + Math.ceil(segundos) * 700);
// Menos de 10 s de contexto hace que el decodificador repita la frase en bucle (medido en esta CPU)
const CONTEXTO_MIN = 500, CONTEXTO_MAX = 1500, CONTEXTO_POR_SEGUNDO = 50;

const disponible = () => fs.existsSync(BINARIO) && fs.existsSync(MODELO);

function contextoDe(segundos) {
  return Math.min(CONTEXTO_MAX, Math.max(CONTEXTO_MIN, Math.ceil(segundos + 1) * CONTEXTO_POR_SEGUNDO));
}

function aWav(audio) {
  const b = Buffer.alloc(44 + audio.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + audio.length * 2, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(FRECUENCIA, 24); b.writeUInt32LE(FRECUENCIA * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(audio.length * 2, 40);
  for (let i = 0; i < audio.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio[i])) * 32767), 44 + i * 2);
  return b;
}

// Devuelve { text, ms } o { error }. Nunca lanza: el que llama decide si pasa a WebAssembly.
function transcribir(audio) {
  return new Promise((resolver) => {
    if (!disponible()) return resolver({ error: "whisper.cpp no está instalado" });
    const t0 = Date.now();
    // Con audio por stdin hay que dar «-of NUL», o el texto no aparece en la salida. No crea ningún archivo.
    const args = ["-m", MODELO, "-f", "-", "-of", "NUL", "-l", "es", "-t", String(HILOS), "-ac", String(contextoDe(audio.length / FRECUENCIA)), "-nt", "-nf", "-mc", "0", "-bs", "1", "-bo", "1", "-np"];
    const hijo = spawn(BINARIO, args, { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    // Por encima de Gemma: oír a tiempo («Merlín, cállate») importa más que unos tokens más rápidos
    try { os.setPriority(hijo.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch {}
    const trozos = [];
    let terminado = false;
    const fin = (r) => { if (terminado) return; terminado = true; clearTimeout(limite); resolver(r); };
    const limiteMs = limiteDe(audio.length / FRECUENCIA);
    const limite = setTimeout(() => { hijo.kill(); fin({ error: `whisper.cpp superó ${limiteMs / 1000} s` }); }, limiteMs);
    hijo.stdout.on("data", (d) => trozos.push(d));
    hijo.on("error", (e) => fin({ error: e.message }));
    hijo.on("close", (codigo) => {
      if (codigo !== 0) return fin({ error: `whisper.cpp terminó con código ${codigo}` });
      fin({ text: Buffer.concat(trozos).toString("utf8").replace(/\s+/g, " ").trim(), ms: Date.now() - t0 });
    });
    hijo.stdin.on("error", () => {}); // si el proceso muere antes de leer, ya lo informa «close»
    hijo.stdin.end(aWav(audio));
  });
}

module.exports = { disponible, transcribir, contextoDe, limiteDe, aWav };
