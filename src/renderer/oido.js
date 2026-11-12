// Micrófono de Merlín: usa el dispositivo predeterminado de Windows, se reconecta si cambia o se desconecta,
// y entrega las frases ya recortadas. El audio se queda en memoria y nunca se guarda.
import { crearSegmentador } from "./oido-nucleo.js";

const REINTENTO_MS = 5000;

export function crearOido({ alEmpezarVoz, alSegmento, alDescartar, alEstado, factor = () => 1, limiteFrase = () => undefined, log }) {
  let activo = false, mic = null, reintento = null, abriendo = null;
  const segmentador = crearSegmentador();

  function cerrarMic() {
    if (!mic) return;
    mic.proc.disconnect(); mic.src.disconnect();
    mic.pista.onended = null;
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.ctx.close().catch(() => {});
    mic = null;
    segmentador.reiniciar();
  }

  async function abrirMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!activo) { stream.getTracks().forEach((t) => t.stop()); return; }
    const ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1); // 128 ms por bloque
    proc.onaudioprocess = (ev) => {
      const r = segmentador.alimentar(new Float32Array(ev.inputBuffer.getChannelData(0)), factor(), limiteFrase());
      if (r?.tipo === "inicio") alEmpezarVoz();
      else if (r?.tipo === "fin") alSegmento(r.audio, r.ms);
      else if (r?.tipo === "descartado") alDescartar();
    };
    src.connect(proc); proc.connect(ctx.destination); // no suena: el procesador no copia nada a su salida
    const pista = stream.getAudioTracks()[0];
    pista.onended = () => { log("Micrófono desconectado"); reabrir(); };
    mic = { stream, ctx, src, proc, pista };
    if (ctx.state !== "running") await ctx.resume();
    log(`Micrófono: ${pista.label}`);
    alEstado("activo");
  }

  function reabrir() {
    cerrarMic();
    clearTimeout(reintento);
    if (activo) return intentar();
  }
  function intentar() {
    abriendo ??= abrirMic()
      .then(() => true)
      .catch((e) => {
        log("Sin micrófono:", e.name, e.message);
        alEstado("sinMic", e.name);
        clearTimeout(reintento);
        if (activo) reintento = setTimeout(intentar, REINTENTO_MS);
        return false;
      })
      .finally(() => { abriendo = null; });
    return abriendo;
  }

  // Si enchufan unos audífonos o cambia el predeterminado de Windows, se pasa a ese sin tocar nada
  navigator.mediaDevices.addEventListener("devicechange", async () => {
    if (!activo) return;
    const lista = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const predeterminado = lista.find((d) => d.kind === "audioinput" && d.deviceId === "default");
    if (!mic || mic.pista.readyState !== "live" || (predeterminado && predeterminado.label !== mic.pista.label)) {
      log("Cambió el micrófono:", predeterminado?.label || "sin predeterminado");
      reabrir();
    }
  });

  return {
    async iniciar() { if (activo && mic) return true; activo = true; return intentar(); },
    detener() { activo = false; clearTimeout(reintento); cerrarMic(); alEstado("apagado"); },
    activo: () => activo,
    oyendoVoz: () => segmentador.hablando(),
    diagnostico: () => ({ activo, microfono: mic?.pista.label || null, ruido: +segmentador.ruido().toFixed(4) }),
  };
}
