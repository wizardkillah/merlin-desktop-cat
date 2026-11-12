// Núcleo del oído, sin navegador para poder probarlo: separa la voz del silencio y reconoce la invocación «Merlín».

// Recibe bloques de audio y avisa cuando empieza y termina una frase.
// Guarda un poco de audio previo para no comerse la primera sílaba.
export function crearSegmentador({ frecuencia = 16000, prerollMs = 400, finSilencioMs = 900, minVozMs = 250, maxMs = 20000, umbralMin = 0.012, factorRuido = 2.8, confirmarMs = 200 } = {}) {
  let ruido = 0.004, enVoz = false, rachaMs = 0, vozMs = 0, silencioMs = 0, totalMs = 0, sumaRms = 0, bloques = 0;
  let previo = [], previoMs = 0, trozos = [];
  const reiniciarFrase = () => { enVoz = false; rachaMs = 0; vozMs = 0; silencioMs = 0; totalMs = 0; sumaRms = 0; bloques = 0; trozos = []; previo = []; previoMs = 0; };
  // El ruido de fondo se aprende del silencio. Antes se aprendía también del eco de Merlín mientras hablaba: tras
  // una respuesta larga el umbral quedaba alto, la voz del usuario no lo superaba y, al tomarse también como
  // ruido, lo subía más. Merlín dejaba de oír el llamado. Ahora:
  // - mientras habla Merlín (factor > 1) no se aprende nada;
  // - baja deprisa (el silencio de verdad se recupera en un par de segundos);
  // - sube despacio, y solo con sonidos parecidos al fondo, no con algo que podría ser una voz.
  const aprenderRuido = (rms, factor) => {
    if (factor > 1) return;
    if (rms < ruido) ruido += (rms - ruido) * 0.15;
    else if (rms < ruido * 2) ruido += (rms - ruido) * 0.02;
  };
  const unir = () => {
    const audio = new Float32Array(trozos.reduce((n, t) => n + t.length, 0));
    let o = 0; for (const t of trozos) { audio.set(t, o); o += t.length; }
    return audio;
  };
  return {
    // factor > 1 pide más volumen para contar como voz (mientras suena Merlín por el altavoz).
    // limiteMs acorta la frase: con música de fondo nunca hay silencio, y la orden no debe esperar 20 s.
    alimentar(bloque, factor = 1, limiteMs = maxMs) {
      let s = 0; for (let i = 0; i < bloque.length; i++) s += bloque[i] * bloque[i];
      const rms = Math.sqrt(s / bloque.length), ms = (bloque.length / frecuencia) * 1000;
      const fuerte = rms > Math.max(umbralMin, ruido * factorRuido) * factor;
      if (!enVoz) {
        previo.push(bloque); previoMs += ms;
        while (previoMs - previo[0].length / frecuencia * 1000 >= prerollMs) { previoMs -= previo[0].length / frecuencia * 1000; previo.shift(); }
        if (!fuerte) { aprenderRuido(rms, factor); rachaMs = 0; return null; }
        rachaMs += ms;
        if (rachaMs < confirmarMs) return null;
        enVoz = true; trozos = previo; previo = []; vozMs = rachaMs; totalMs = previoMs;
        return { tipo: "inicio" };
      }
      trozos.push(bloque); totalMs += ms; sumaRms += rms; bloques++;
      if (fuerte) { vozMs += ms; silencioMs = 0; } else silencioMs += ms;
      if (silencioMs >= finSilencioMs || totalMs >= limiteMs) {
        // Un ruido constante que nunca baja no debe contarse como voz para siempre: se aprende como fondo
        // (no mientras habla Merlín: eso sería su propio eco, que se acaba al callar)
        if (totalMs >= maxMs && factor <= 1) ruido = Math.min(0.08, Math.max(ruido, (sumaRms / bloques) * 0.6));
        const fin = vozMs >= minVozMs ? { tipo: "fin", audio: unir(), ms: totalMs } : { tipo: "descartado" };
        reiniciarFrase();
        return fin;
      }
      return null;
    },
    hablando: () => enVoz,
    ruido: () => ruido,
    reiniciar: reiniciarFrase,
  };
}

const sinAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const normalizar = (s) => sinAcentos(s).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

function distancia(a, b) {
  const f = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previa = f[0]; f[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = f[j]; f[j] = Math.min(f[j] + 1, f[j - 1] + 1, previa + (a[i - 1] === b[j - 1] ? 0 : 1)); previa = t; }
  }
  return f[b.length];
}

const NOMBRES = new Set(["merlin", "merlyn", "merlim", "marlin"]);
// «Oye» se transcribe a menudo como «Hoy» u «Hoy en»
const SALUDOS = new Set(["oye", "hey", "ey", "hola", "eh", "mira", "ola", "hoy"]);
const PARECIDOS_MIN = 5;
const PARECIDOS_LEJANOS = new Set(["marin"]);

// ¿Han llamado a Merlín? Devuelve { invocado, resto }: resto es lo que pidió, sin el nombre.
// Whisper a veces oye «Berlín», «Marin» o «Merlí»: un parecido solo cuenta al principio y seguido de una pausa,
// para que «viajo a Berlín en marzo» no lo despierte.
export function detectarInvocacion(texto) {
  const palabras = [...texto.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ crudo: m[0], norm: sinAcentos(m[0]), ini: m.index, fin: m.index + m[0].length }));
  const prefijo = palabras[0]?.norm === "hoy" && palabras[1]?.norm === "en" ? 2 : SALUDOS.has(palabras[0]?.norm) ? 1 : 0;
  let i = palabras.findIndex((p) => NOMBRES.has(p.norm));
  if (i < 0) {
    const p = palabras[prefijo];
    const conPausa = p && /^\s*([,.:;!?¿¡…]|$)/.test(texto.slice(p.fin));
    if (p && conPausa && p.norm.length >= PARECIDOS_MIN && (distancia(p.norm, "merlin") <= 1 || PARECIDOS_LEJANOS.has(p.norm))) i = prefijo;
  }
  if (i < 0) return { invocado: false, resto: texto.trim() };
  // Al principio se quita también el saludo que lo acompaña («Oye, Merlín, …»)
  const alInicio = i === 0 || i === prefijo;
  const p = palabras[i];
  const resto = alInicio
    ? texto.slice(p.fin).replace(/^[\s,.:;!?…]+/, "")
    : (texto.slice(0, p.ini).replace(/[\s,;:]+$/, "") + " " + texto.slice(p.fin).replace(/^[\s,;:]+/, "")).replace(/\s+([.!?…])/g, "$1");
  const limpio = resto.trim();
  return { invocado: true, resto: /[\p{L}\p{N}]/u.test(limpio) ? limpio : "" };
}

// Whisper inventa estas frases con silencio o ruido, y a veces repite la frase entera en bucle
const ALUCINACION = /^(\[.*\]|\(.*\)|\*.*\*|¡?gracias( por ver(lo)?)?[.!]*|subt[ií]tulos.*|amara\.org.*|\.+|…)$/i;
export function limpiarTranscripcion(texto) {
  const t = texto.trim();
  if (ALUCINACION.test(t)) return "";
  const crudas = t.split(/\s+/), planas = crudas.map(normalizar);
  for (let p = 1; p <= planas.length / 2; p++) {
    // Se admite que la última repetición quede cortada
    if (planas.every((w, i) => w === planas[i % p])) return crudas.slice(0, p).join(" ");
  }
  return t;
}

// «Cállate» sale de Whisper como «cayate», «cajate», «caiate», «quayate» o «ayate»: se compara por cómo suena,
// y se tolera una letra de diferencia
const porSonido = (s) => s.replace(/qu/g, "k").replace(/c(?=[aou])/g, "k").replace(/ll|j|i(?=[aeou])/g, "y");
const ORDEN_CALLAR = /^(para|parar|kaya|kayate|silencyo|detente|basta|kancela|olvidalo|stop|ya esta|ya basta)( ya| por favor)?$/;
export const esOrdenCallar = (texto) => {
  const t = porSonido(normalizar(texto));
  return ORDEN_CALLAR.test(t) || distancia(t.replace(/ (ya|por favor)$/, ""), "kayate") <= 1;
};

// ¿Lo que oye el micrófono es lo que acaba de decir Merlín por el altavoz?
export function esEco(oido, dicho, umbral = 0.7) {
  const o = normalizar(oido), d = normalizar(dicho);
  if (!o || !d) return false;
  const palabras = o.split(" ");
  if (palabras.length < 3) return ` ${d} `.includes(` ${o} `);
  // Solo cuentan las palabras con significado: «es» o «la» aparecen en cualquier frase
  const conPeso = palabras.filter((w) => w.length >= 4);
  const enDicho = new Set(d.split(" "));
  const lista = conPeso.length >= 2 ? conPeso : palabras;
  return lista.filter((w) => enDicho.has(w)).length / lista.length >= umbral;
}

// Sonidos de asentir: no piden nada
const MULETILLA = /^(a+ja+|mm+|mhm+|eh+|ah+|oh+|uh+|ok|okay|vale|ya|bueno|si|aja si|ya veo|claro|ajam)$/;
export const esMuletilla = (texto) => MULETILLA.test(normalizar(texto));

// Qué Whisper usar. whisper.cpp reconoce mejor que el de WebAssembly (decodificador cuantizado) y es más rápido.
// Antes, un solo fallo lo apagaba hasta cerrar la app: por ejemplo, superar el tiempo límite mientras Gemma
// ocupaba la CPU. Ahora un fallo suelto solo manda esa frase al respaldo; tras varios seguidos descansa un rato
// y vuelve a intentarlo. Si no está instalado, no se intenta.
export function crearSelectorOido({ instalado, fallosParaPausa = 3, pausaMs = 120000, ahora = () => Date.now() } = {}) {
  let seguidos = 0, pausadoHasta = 0;
  return {
    usarNativo: () => !!instalado && ahora() >= pausadoHasta,
    exito() { seguidos = 0; },
    // Devuelve true si a partir de ahora descansa
    fallo() {
      seguidos++;
      if (seguidos < fallosParaPausa) return false;
      seguidos = 0; pausadoHasta = ahora() + pausaMs;
      return true;
    },
  };
}
