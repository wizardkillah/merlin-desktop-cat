// Boca de Merlín: voz neuronal Piper en un worker, con tono y ambiente propios.
// Si no se puede usar, recurre a la voz del sistema.
import { fragmentar, agrupar, pausaTras, ritmoDe, PERFILES, claveFrase, leerWav, recortarSilencio } from "./voz-nucleo.js";

// Tras una respuesta, un segundo de silencio antes de volver a escuchar: la frase termina de salir del parlante
// y su eco se apaga sin que nada la pise.
const SILENCIO_FINAL_MS = 1000;
// Al sonar tras un silencio, una entrada corta: algunos parlantes tardan en despertar y se comen la primera sílaba.
const ENTRADA_TRAS_SILENCIO = 0.18;

export function crearVoz({ alEmpezar, alTerminar, alDescansar = () => {}, log }) {
  let frecuencia = 22050, ctx = null, cadena = null, modo = "cargando", perfil = PERFILES.merlin;
  let generacion = 0, siguienteId = 0, enCola = 0, sonandoAhora = 0, finPrevio = 0, descanso = null;
  const fuentes = new Set(), pendientes = [];
  let linea = []; // qué se dice y cuándo, para saber hasta dónde se oyó
  const medidas = { grabadas: 0, frases: 0, msGenerar: 0, segundosAudio: 0, primeraMs: null, huecos: 0, segundosHueco: 0, pico: 0 };
  let t0Pedido = 0, avisoInicio = false;

  const avisarSiTermino = () => {
    if (enCola !== 0 || sonandoAhora !== 0 || !avisoInicio) return;
    avisoInicio = false;
    alTerminar();
    clearTimeout(descanso);
    descanso = setTimeout(() => { descanso = null; alDescansar(); }, SILENCIO_FINAL_MS);
  };
  const worker = new Worker("tts-worker.js");

  // ---------- Sonido: voz → cuerpo (saturación suave y graves) → salida, más una parte hacia el eco ----------
  function eco(segundos = 1.1) {
    const n = Math.round(ctx.sampleRate * segundos), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let canal = 0; canal < 2; canal++) {
      const d = ir.getChannelData(canal);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return ir;
  }
  function curvaCuerpo(k) {
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; c[i] = Math.tanh(x * (1 + k * 2)) / Math.tanh(1 + k * 2); }
    return c;
  }
  function montarCadena() {
    ctx = new AudioContext({ sampleRate: frecuencia });
    const entrada = ctx.createGain(), satura = ctx.createWaveShaper(), graves = ctx.createBiquadFilter();
    const seco = ctx.createGain(), convolver = ctx.createConvolver(), mojado = ctx.createGain(), analizador = ctx.createAnalyser();
    graves.type = "lowshelf"; graves.frequency.value = 240;
    satura.oversample = "2x";
    convolver.buffer = eco();
    analizador.fftSize = 2048;
    entrada.connect(satura).connect(graves);
    graves.connect(seco).connect(analizador);
    graves.connect(convolver).connect(mojado).connect(analizador);
    analizador.connect(ctx.destination);
    cadena = { entrada, satura, graves, seco, mojado, analizador };
    aplicarPerfil();
    const muestras = new Float32Array(analizador.fftSize);
    setInterval(() => {
      if (!sonandoAhora) return;
      analizador.getFloatTimeDomainData(muestras);
      for (const v of muestras) if (Math.abs(v) > medidas.pico) medidas.pico = Math.abs(v);
    }, 60);
  }
  function aplicarPerfil() {
    if (!cadena) return;
    cadena.satura.curve = curvaCuerpo(perfil.cuerpo);
    cadena.graves.gain.value = perfil.cuerpo * 8;
    cadena.seco.gain.value = 0.9 - perfil.ambiente * 0.5;
    cadena.mojado.gain.value = perfil.ambiente;
  }

  function reproducir(audio, pausa, tono, hz = frecuencia, texto = "") {
    if (!ctx) montarCadena();
    if (ctx.state !== "running") ctx.resume();
    clearTimeout(descanso); descanso = null;
    const buf = ctx.createBuffer(1, audio.length, hz);
    buf.copyToChannel(audio, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = tono;
    src.connect(cadena.entrada);
    const ahora = ctx.currentTime + 0.02;
    if (finPrevio && ahora > finPrevio && ahora - finPrevio < 8) { medidas.huecos++; medidas.segundosHueco += ahora - finPrevio; } // silencio de más dentro de una misma respuesta
    const trasSilencio = !avisoInicio && ahora > finPrevio;
    const inicio = Math.max(trasSilencio ? ahora + ENTRADA_TRAS_SILENCIO : ahora, finPrevio);
    finPrevio = inicio + buf.duration / tono + pausa;
    linea.push({ texto, ini: inicio, fin: inicio + buf.duration / tono });
    fuentes.add(src);
    sonandoAhora++;
    src.onended = () => { fuentes.delete(src); sonandoAhora--; avisarSiTermino(); };
    src.start(inicio);
    if (!avisoInicio) { avisoInicio = true; alEmpezar(); }
  }

  // ---------- Frases fijas grabadas con la voz de Merlín. Si falta alguna, la dice Piper ----------
  const BASE_GRABADAS = "/assets/voces/merlin/";
  const grabadas = new Map();
  const grabadasListas = (async () => {
    const r = await fetch(BASE_GRABADAS + "manifiesto.json");
    if (!r.ok) return log("Sin frases grabadas: se usará Piper para todo");
    const { frases } = await r.json();
    for (const [clave, { archivo }] of Object.entries(frases)) {
      try {
        const { audio, frecuencia: hz } = leerWav(await (await fetch(BASE_GRABADAS + archivo)).arrayBuffer());
        // Vienen más fuertes que Piper (pico 0,76 frente a 0,56): sin igualarlas, el cambio de voz da un salto de volumen
        grabadas.set(clave, { audio: recortarSilencio(audio, hz).map((m) => m * 0.74), hz });
      } catch (e) { log(`Frase grabada ${archivo} no disponible:`, e.message); }
    }
    log(`Frases grabadas listas: ${grabadas.size}`);
  })().catch((e) => log("Sin frases grabadas:", e.message));

  // Solo si no hay nada pendiente de Piper: una frase grabada no debe adelantarse a lo que ya está en cola
  function decirGrabada(texto) {
    if (enCola > 0 || speechSynthesis.speaking) return false;
    const g = grabadas.get(claveFrase(texto));
    if (!g) return false;
    medidas.grabadas++;
    reproducir(g.audio, pausaTras(texto), 1, g.hz, texto); // sin cambio de tono: es la voz de la referencia
    return true;
  }

  // ---------- Respaldo: la voz del sistema, si el modelo no carga o falla ----------
  let vozSistema = null;
  const elegirSistema = () => {
    const vs = speechSynthesis.getVoices();
    vozSistema = vs.find((v) => /sabina/i.test(v.name) && /^es/i.test(v.lang)) || vs.find((v) => /^es/i.test(v.lang)) || null;
  };
  speechSynthesis.onvoiceschanged = elegirSistema; elegirSistema();
  function decirSistema(item) {
    const u = new SpeechSynthesisUtterance(item.frase ?? item);
    if (vozSistema) u.voice = vozSistema;
    u.lang = vozSistema?.lang || "es-MX";
    enCola++;
    u.onstart = () => { if (!avisoInicio) { avisoInicio = true; alEmpezar(); } };
    u.onend = u.onerror = () => { enCola = Math.max(0, enCola - 1); avisarSiTermino(); };
    speechSynthesis.speak(u);
  }
  function pasarASistema(motivo) {
    if (modo === "sistema") return;
    modo = "sistema";
    log("Voz neuronal no disponible, uso la del sistema:", motivo);
    const resto = pendientes.splice(0);
    enCola = 0;
    resto.forEach(decirSistema);
  }

  worker.onmessage = ({ data }) => {
    if (data.type === "ready") {
      frecuencia = data.frecuencia; modo = "neuronal";
      log(`Voz neuronal lista en ${data.ms} ms (${data.hilos} hilos)`);
    }
    if (data.type === "failed") return pasarASistema(data.error);
    if (data.type === "audio") {
      if (data.generacion < generacion) return;
      const item = pendientes.shift();
      enCola = Math.max(0, enCola - 1);
      const tono = item?.tono ?? 1;
      const seg = data.audio.length / frecuencia / tono;
      medidas.frases++; medidas.msGenerar += data.ms; medidas.segundosAudio += seg;
      medidas.primeraMs ??= Math.round(performance.now() - t0Pedido);
      reproducir(data.audio, pausaTras(item?.frase || ""), tono, frecuencia, item?.frase || "");
    }
  };
  worker.onerror = (e) => pasarASistema(e.message || "el worker no arrancó");

  return {
    grabadasListas,
    salida() { if (!ctx) montarCadena(); return cadena.analizador; }, // para la prueba de voz
    hablar(texto) {
      clearTimeout(descanso); descanso = null;
      if (decirGrabada(texto)) return;
      const frases = agrupar(fragmentar(texto));
      if (!frases.length) return;
      if (enCola === 0 && sonandoAhora === 0) { t0Pedido = performance.now(); medidas.primeraMs = null; }
      if (modo === "sistema") return frases.forEach(decirSistema);
      for (const frase of frases) {
        enCola++;
        const { tono, ruido, variacion, ritmo = 1 } = perfil;
        pendientes.push({ frase, tono });
        // Más rápido al generar y más lento al reproducir: baja el tono sin cambiar la duración
        worker.postMessage({ type: "say", id: ++siguienteId, generacion, frase, ritmo: ritmoDe(frase) * tono * ritmo, ruido, variacion });
      }
    },
    callar() {
      generacion++;
      worker.postMessage({ type: "cancel", generacion });
      for (const s of fuentes) { s.onended = null; try { s.stop(); } catch {} }
      fuentes.clear();
      pendientes.length = 0;
      enCola = 0; sonandoAhora = 0; finPrevio = 0;
      speechSynthesis.cancel();
      avisoInicio = false;
      clearTimeout(descanso); descanso = null;
      linea = [];
    },
    // Lo que se alcanzó a decir de una respuesta: las frases enteras y, de la que suena, la parte ya dicha.
    // Los «déjame pensarlo» de la espera no forman parte de ella.
    loDicho(respuesta) {
      if (!ctx) return "";
      const t = ctx.currentTime, partes = [], completa = claveFrase(respuesta);
      for (const { texto, ini, fin } of linea) {
        if (!completa.includes(claveFrase(texto))) continue;
        if (t >= fin) { partes.push(texto); continue; }
        if (t > ini) {
          const palabras = texto.split(" ");
          partes.push(palabras.slice(0, Math.floor((palabras.length * (t - ini)) / (fin - ini))).join(" "));
        }
        break;
      }
      return partes.join(" ").trim();
    },
    reiniciarLinea() { linea = []; },
    enDescanso: () => descanso !== null,
    perfil(nombre) { perfil = PERFILES[nombre] || PERFILES.merlin; aplicarPerfil(); },
    sonando: () => avisoInicio || enCola > 0 || sonandoAhora > 0,
    diagnostico: () => ({ modo, perfil: perfil.nombre, ...medidas, velocidad: medidas.msGenerar ? +(medidas.segundosAudio / (medidas.msGenerar / 1000)).toFixed(2) : null }),
  };
}
