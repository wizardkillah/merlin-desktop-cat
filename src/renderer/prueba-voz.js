// Prueba de la voz dentro del programa real: electron . --prueba-voz=carpeta [--prueba-voz-modo=medir]
// Suena por el altavoz y guarda en WAV lo que sale por la cadena de audio, para medirlo y escucharlo después.
const ESPERA_MAX_MS = 6 * 60 * 1000;

function crearWav(muestras, frecuencia) {
  const b = new ArrayBuffer(44 + muestras.length * 2), v = new DataView(b);
  const texto = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  texto(0, "RIFF"); v.setUint32(4, b.byteLength - 8, true); texto(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, frecuencia, true); v.setUint32(28, frecuencia * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  texto(36, "data"); v.setUint32(40, muestras.length * 2, true);
  muestras.forEach((m, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, m)) * 32767, true));
  return new Uint8Array(b);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export async function correrPruebaVoz({ api, voz, ask, modo, frases }) {
  await voz.grabadasListas;
  const analizador = voz.salida(), ctx = analizador.context;
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  let tramos = null;
  proc.onaudioprocess = (e) => { if (tramos) tramos.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  analizador.connect(proc); proc.connect(ctx.destination);
  const resultados = [];

  async function tramo(nombre, descripcion, accion) {
    const antes = voz.diagnostico(), t0 = performance.now();
    tramos = [];
    let primerSonido = null, error = null;
    const vigia = setInterval(() => { if (primerSonido === null && voz.sonando() && tramos?.some((t) => t.some((m) => Math.abs(m) > 0.01))) primerSonido = Math.round(performance.now() - t0); }, 100);
    try {
      await accion();
      const limite = performance.now() + ESPERA_MAX_MS;
      await dormir(300);
      while (voz.sonando() && performance.now() < limite) await dormir(200);
      await dormir(400);
    } catch (e) { error = String(e?.message || e); }
    clearInterval(vigia);
    const capturado = tramos; tramos = null;
    const n = capturado.reduce((s, t) => s + t.length, 0), audio = new Float32Array(n);
    let o = 0, pico = 0;
    for (const t of capturado) { audio.set(t, o); o += t.length; }
    for (const m of audio) if (Math.abs(m) > pico) pico = Math.abs(m);
    const despues = voz.diagnostico();
    api.guardarPruebaVoz(nombre + ".wav", crearWav(audio, ctx.sampleRate));
    const r = { nombre, descripcion, msHastaSonido: primerSonido, msTotal: Math.round(performance.now() - t0), segundosCapturados: +(n / ctx.sampleRate).toFixed(2), pico: +pico.toFixed(3), grabadas: despues.grabadas - antes.grabadas, frasesPiper: despues.frases - antes.frases, huecos: despues.huecos - antes.huecos, segundosHueco: +(despues.segundosHueco - antes.segundosHueco).toFixed(2), modo: despues.modo, perfil: despues.perfil, error };
    resultados.push(r);
    api.log("[prueba-voz]", JSON.stringify(r));
  }

  // Piper tarda en cargar: sin esto, la primera frase mediría la carga y no la voz
  const inicio = performance.now();
  while (voz.diagnostico().modo === "cargando" && performance.now() - inicio < 120000) await dormir(200);

  for (const [nombre, descripcion, accion] of frases({ voz, ask, modo })) await tramo(nombre, descripcion, accion);

  proc.disconnect(); analizador.disconnect(proc);
  api.guardarPruebaVoz("resultado.json", new TextEncoder().encode(JSON.stringify(resultados, null, 2)));
  await dormir(300);
  api.testDone(resultados);
}
