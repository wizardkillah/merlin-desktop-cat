// Web Worker: Whisper en local con WebAssembly (sin DLLs ni instalaciones).
// El modelo se descarga de Hugging Face la primera vez y queda en la caché de la app.
import { pipeline, env } from "/node_modules/@huggingface/transformers/dist/transformers.js";

const MODEL = new URL(self.location.href).searchParams.get("model") || "onnx-community/whisper-base";
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)) : 1;

let asr = null;
async function load() {
  if (asr) return asr;
  asr = pipeline("automatic-speech-recognition", MODEL, {
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) self.postMessage({ type: "progress", pct: Math.round((p.loaded / p.total) * 100), file: p.file });
    },
  });
  asr = await asr;
  self.postMessage({ type: "ready", threads: env.backends.onnx.wasm.numThreads, isolated: self.crossOriginIsolated });
  return asr;
}

const HALLUCINATIONS = /^(\[.*\]|\(.*\)|¡?gracias( por ver(lo)?)?[.!]*|subt[ií]tulos.*|amara\.org.*|\.+|…)$/i;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") return void (await load());
    if (data.type === "transcribe") {
      const t0 = performance.now();
      const model = await load();
      const out = await model(data.audio, { language: "spanish", task: "transcribe", chunk_length_s: 30 });
      let text = (out.text || "").trim();
      if (HALLUCINATIONS.test(text)) text = "";
      self.postMessage({ type: "result", id: data.id, text, ms: Math.round(performance.now() - t0) });
    }
  } catch (e) {
    self.postMessage({ type: "error", id: data.id, error: String(e?.message || e) });
  }
};
