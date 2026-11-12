// Web Worker: voz neuronal Piper en local con WebAssembly. Convierte frases en audio; nada sale del PC.
// Es un worker clásico porque piper_phonemize.js no es un módulo: se carga con importScripts y ONNX con import().
const BASE_FONEMAS = "/node_modules/@diffusionstudio/piper-wasm/build/";
const BASE_ORT = "/node_modules/onnxruntime-web/dist/";
const MODELO = "/assets/voces/es_MX-claude-high.onnx";

importScripts(BASE_FONEMAS + "piper_phonemize.js");

let listo = null;
function cargar() {
  listo ??= (async () => {
    const t0 = performance.now();
    const ort = await import(BASE_ORT + "ort.wasm.min.mjs");
    ort.env.wasm.wasmPaths = BASE_ORT;
    // Comparte la CPU con el modelo de chat: tres hilos dan voz fluida sin acapararla
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : 1;
    const config = await (await fetch(MODELO + ".json")).json();
    const sesion = await ort.InferenceSession.create(MODELO, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    const fonemas = await crearFonemas();
    const nucleo = await import("/src/renderer/voz-nucleo.js");
    self.postMessage({ type: "ready", ms: Math.round(performance.now() - t0), hilos: ort.env.wasm.numThreads, frecuencia: config.audio.sample_rate });
    return { ort, config, sesion, fonemas, nucleo };
  })();
  return listo;
}

// El conversor es un programa de línea de comandos compilado: escribe una línea JSON por cada frase
async function crearFonemas() {
  let alRecibir = null, ultimoError = "";
  const modulo = await createPiperPhonemize({
    print: (linea) => alRecibir?.(linea),
    printErr: (linea) => { ultimoError = linea; },
    locateFile: (archivo) => BASE_FONEMAS + archivo,
  });
  return (frase, voz) => new Promise((resuelve, rechaza) => {
    alRecibir = (linea) => {
      alRecibir = null;
      try { const r = JSON.parse(linea); resuelve({ ids: r.phoneme_ids, fonemas: r.phonemes }); } catch (e) { rechaza(e); }
    };
    try {
      modulo.callMain(["-l", voz, "--input", JSON.stringify([{ text: frase }]), "--espeak_data", "/espeak-ng-data"]);
    } catch (e) {
      if (e?.name !== "ExitStatus") return rechaza(e);
    }
    if (alRecibir) rechaza(new Error("El conversor de fonemas no respondió: " + ultimoError));
  });
}

async function sintetizar(frase, { ritmo = 1, ruido, variacion } = {}) {
  const { ort, config, sesion, fonemas, nucleo } = await cargar();
  const ids = nucleo.suavizarR((await fonemas(frase, config.espeak.voice)).ids, config.phoneme_id_map);
  const { noise_scale, length_scale, noise_w } = config.inference;
  const salida = await sesion.run({
    input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([ruido ?? noise_scale, length_scale * ritmo, variacion ?? noise_w]), [3]),
  });
  return nucleo.recortarSilencio(new Float32Array(salida.output.data), config.audio.sample_rate);
}

// Se atiende de una en una. Lo cancelado mientras tanto se salta sin generarlo.
let generacion = 0, cola = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type === "cancel") { generacion = data.generacion; return; }
  if (data.type === "fonemas") { // diagnóstico: cómo se va a pronunciar un texto, sin generar audio
    cargar().then(async ({ config, fonemas }) => self.postMessage({ type: "fonemas", id: data.id, fonemas: (await fonemas(data.frase, config.espeak.voice)).fonemas }));
    return;
  }
  if (data.type !== "say") return;
  cola = cola.then(async () => {
    if (data.generacion < generacion) return;
    const t0 = performance.now();
    try {
      const audio = await sintetizar(data.frase, data);
      if (data.generacion < generacion) return;
      self.postMessage({ type: "audio", id: data.id, generacion: data.generacion, audio, ms: Math.round(performance.now() - t0) }, [audio.buffer]);
    } catch (e) {
      self.postMessage({ type: "failed", id: data.id, error: String(e?.message || e) });
    }
  });
};
cargar().catch((e) => self.postMessage({ type: "failed", error: String(e?.message || e) }));
