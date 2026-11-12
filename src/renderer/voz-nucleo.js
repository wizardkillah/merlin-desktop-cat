// Partes puras de la voz, separadas para poder probarlas sin navegador.
// Piper no entiende SSML: las pausas, el ritmo y la pronunciación se controlan aquí, antes de generar el audio.

// Corta un texto en frases cortas: se generan y se oyen una a una, sin esperar al texto completo.
export function fragmentar(texto, max = 220) {
  // El punto solo corta si le sigue un espacio o el final: «80.000» es un número, no dos frases
  const frases = texto.replace(/\s+/g, " ").match(/.+?(?:[.!?…]+["»)]*(?=\s|$)|$)/g) || [];
  const salida = [];
  for (let f of frases.map((x) => x.trim()).filter(Boolean)) {
    while (f.length > max) {
      let corte = Math.max(f.lastIndexOf(", ", max), f.lastIndexOf("; ", max), f.lastIndexOf(": ", max));
      if (corte < max / 3) corte = f.lastIndexOf(" ", max);
      if (corte < 1) corte = max;
      salida.push(f.slice(0, corte + 1).trim());
      f = f.slice(corte + 1).trim();
    }
    if (f) salida.push(f);
  }
  return salida;
}

// Une frases cortas para generarlas de una vez: el modelo enlaza mejor dentro de un mismo trozo que entre dos sueltos.
export function agrupar(frases, max = 170) {
  const salida = [];
  for (const f of frases) {
    const ultima = salida.at(-1);
    if (ultima && ultima.length + f.length + 1 <= max) salida[salida.length - 1] = ultima + " " + f;
    else salida.push(f);
  }
  return salida;
}

// La «rr» vibrante de este modelo suena marcada, casi rusa. La vibrante simple es más suave y cercana.
export function suavizarR(ids, mapa) {
  const fuerte = mapa["r"]?.[0], suave = mapa["ɾ"]?.[0];
  if (fuerte === undefined || suave === undefined) return ids;
  return ids.map((id) => (id === fuerte ? suave : id));
}

// Quita el silencio que Piper deja en los bordes (las pausas las decide pausaTras) y suaviza inicio y fin para evitar chasquidos.
export function recortarSilencio(audio, frecuencia, umbral = 0.012) {
  let ini = 0, fin = audio.length - 1;
  while (ini < audio.length && Math.abs(audio[ini]) < umbral) ini++;
  while (fin > ini && Math.abs(audio[fin]) < umbral) fin--;
  if (ini >= fin) return audio;
  ini = Math.max(0, ini - Math.round(frecuencia * 0.015));
  fin = Math.min(audio.length - 1, fin + Math.round(frecuencia * 0.035));
  const salida = audio.slice(ini, fin + 1);
  const borde = Math.min(Math.round(frecuencia * 0.006), Math.floor(salida.length / 2));
  for (let i = 0; i < borde; i++) {
    const k = i / borde;
    salida[i] *= k;
    salida[salida.length - 1 - i] *= k;
  }
  return salida;
}

// Perfiles de voz. tono: menos de 1 es más grave (se genera más rápido y se reproduce más lento, así la duración no cambia).
// ambiente: cantidad de eco. cuerpo: un poco de saturación y graves. ruido y variacion: viveza de la entonación y del ritmo.
// ritmo: duración de lo que se dice (menos de 1 es más ágil).
export const PERFILES = {
  // Acerca Piper a la voz grabada de Merlin (medido: Piper ~190 Hz, Merlin ~130 Hz y un 10-15 % más rápido).
  // No se iguala el tono del todo: a 0,68 el timbre se hunde muy por debajo del de Merlin.
  merlin: { nombre: "Merlín", tono: 0.78, ambiente: 0, cuerpo: 0, ruido: 0.72, variacion: 0.88, ritmo: 0.9 },
  gato: { nombre: "Gato travieso", tono: 0.9, ambiente: 0.1, cuerpo: 0.3, ruido: 0.72, variacion: 0.88 },
  hechicero: { nombre: "Hechicero", tono: 0.84, ambiente: 0.24, cuerpo: 0.4, ruido: 0.7, variacion: 0.85 },
  natural: { nombre: "Natural", tono: 1, ambiente: 0, cuerpo: 0, ruido: 0.667, variacion: 0.8 },
};

// Cómo se escribe lo que eSpeak leería mal. Se añaden aquí nombres propios, siglas y extranjerismos.
const PRONUNCIACION = [
  [/\bOCR\b/g, "o ce erre"],
  [/\bWebAssembly\b/gi, "uebasémbli"],
  [/\bWhisper\b/gi, "uísper"],
  [/\bGemma\b/gi, "Yema"],
  [/\bExcel\b/gi, "éksel"],
  [/\bWord\b/g, "uord"],
  [/\bMerlin\b/g, "Merlín"],
  [/\bUF\b/g, "u efe"],
  [/\bIA\b/g, "i a"],
  [/\s*\(lms server start\)/g, ""], // el comando se lee en el bocadillo; en voz alta no aporta
];

// Convierte un texto escrito en lo que debe decirse en voz alta
export function paraVoz(t) {
  let s = t
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\\_/g, " ").replace(/_/g, " ")          // nombres de archivo: Contrato_Arriendo -> Contrato Arriendo
    .replace(/[*#`>|\\]/g, "")
    .replace(/\p{Extended_Pictographic}|️|‍/gu, "");
  // Monedas, antes de que eSpeak las lea al revés («dólar ochenta mil»). En Chile, $ son pesos.
  s = s.replace(/\b(?:USD|US\$)\s?(\d[\d.,]*\d|\d)/g, "$1 dólares")
    .replace(/\bCLP\s?(\d[\d.,]*\d|\d)/g, "$1 pesos")
    .replace(/\$\s?(\d[\d.,]*\d|\d)(\s+pesos)?/g, "$1 pesos");
  // Los documentos son del usuario: el modelo a veces dice «mis notas» como si fueran suyas
  s = s.replace(/\b([Mm])is (notas|documentos|archivos|apuntes|papeles)\b/g, (_, m, n) => `${m === "M" ? "Tus" : "tus"} ${n}`)
    .replace(/\b([Mm])i (contrato|documento|archivo|informe|nota)\b/g, (_, m, n) => `${m === "M" ? "Tu" : "tu"} ${n}`);
  for (const [patron, dicho] of PRONUNCIACION) s = s.replace(patron, dicho);
  return s.replace(/\s+/g, " ").trim();
}

// Quita los «miau» sobrantes de una frase. Repetirlo en cada frase suena a grabación.
export function sinMiau(frase) {
  return frase
    .replace(/^\s*¡?\s*miau+\s*[!.,…]*\s*/i, "")
    .replace(/[,;]?\s*¡?\s*miau+\s*!?(?=\s*[.!?…]|\s*$)/gi, "")
    .replace(/^\s*([a-záéíóúñ])/, (m) => m.toUpperCase())
    .trim();
}

// Una exclamación sola, que solo tiene sentido al principio de una respuesta
export const esMuletillaSuelta = (frase) => /^\s*¡?\s*(claro|mira|f[ií]jate|miau+)\s*[!.…,]*\s*$/i.test(frase);

// Identifica una frase aunque luego se retoque (comillas, «miau», «mis» por «tus»): evita repetir o saltar frases
export const claveFrase = (frase) => paraVoz(sinMiau(frase)).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const azar = (rnd, ancho) => (rnd() * 2 - 1) * ancho;

// Silencio tras una frase, en segundos. Equivale a <break> de SSML: varía para no sonar a metrónomo.
export function pausaTras(frase, rnd = Math.random) {
  const final = frase.trim().replace(/["»)]+$/, "").slice(-1);
  const base = { "?": 0.3, "…": 0.36, ".": 0.24, "!": 0.2, ":": 0.2, ";": 0.16, ",": 0.1 }[final] ?? 0.06;
  return +(base * (1 + azar(rnd, 0.15))).toFixed(3);
}

// Velocidad de una frase (más de 1 es más lento). Equivale a <prosody rate>: lo largo se dice con más calma.
export function ritmoDe(frase, rnd = Math.random) {
  const n = frase.length;
  const base = n > 140 ? 1.06 : n > 80 ? 1.03 : n < 25 ? 0.98 : 1;
  return +(base + (/\?\s*$/.test(frase) ? 0.01 : 0) + azar(rnd, 0.012)).toFixed(3);
}

// Elige una variante sin repetir la última de esa lista
const ultimas = new Map();
export function variante(lista, rnd = Math.random) {
  const opciones = lista.filter((x) => x !== ultimas.get(lista));
  const elegida = opciones[Math.floor(rnd() * opciones.length)] ?? lista[0];
  ultimas.set(lista, elegida);
  return elegida;
}

export const FRASES = {
  revisando: ["Claro, déjame revisar mis pergaminos.", "A ver, voy a husmear por ahí.", "Un momento, esto requiere un poco de magia.", "Dame un segundo. Hasta los brujos buscan cosas."],
  pensando: ["Mmm, déjame consultar la bola de cristal.", "A ver, dame un momentito.", "Déjame pensarlo. Con este sombrero cuesta menos.", "Buena pregunta, dame un momento."],
  sigo: ["Sigo en ello. La magia no es instantánea, ¿sabes?", "Paciencia, ya casi lo tengo.", "Esto me está tomando un poquito, pero ya voy."],
  saludo: [
    "Hola, soy {n}, tu gato brujo de escritorio. 🎩 Di «Merlín» cuando me necesites, o haz clic en mí para escribirme.",
    "Aquí {n}, con el sombrero puesto y listo para ayudarte. 🎩 Di «Merlín» cuando me necesites, o haz clic en mí para escribirme.",
    "{n} despierto. ¿En qué te ayudo hoy? ✨ Di «Merlín» cuando me necesites, o haz clic en mí para escribirme.",
  ],
  invocado: ["¿Sí?", "Dime.", "Te escucho.", "¿Qué se te ofrece?"],
  noOido: ["No te he oído, miau. Vuelve a intentarlo.", "No he oído nada. ¿Me lo repites, un poco más alto?", "Silencio total por aquí. Prueba otra vez."],
  noEntendido: ["Miau, no he entendido nada. ¿Repites?", "Eso se me escapó, incluso con estas orejas. ¿Me lo repites?", "No lo pillé. ¿Lo dices otra vez?"],
};

// Del saludo solo se dice la presentación: las instrucciones de uso se leen en el bocadillo
export const saludoHablado = (saludo) => saludo.split(" Di «Merlín»")[0];

// Frases fijas que se oyen con la voz de Merlín grabada de antemano (scripts/pregrabar-voz.mjs), junto con las de
// brain.js, que no se pueden importar desde aquí. Si se cambia una frase y no se vuelve a grabar, la dice Piper.
export const FRASES_PREGRABADAS = [...FRASES.revisando, ...FRASES.pensando, ...FRASES.sigo, "Listo, ya lo olvidé todo.",
  ...FRASES.saludo.map((s) => saludoHablado(s.replace("{n}", "Merlín"))), ...FRASES.invocado, ...FRASES.noOido, ...FRASES.noEntendido];

// La voz de Merlin dice unos 13-16 caracteres por segundo. Muy lejos de eso, la toma salió cortada o rota
// (medido: a 18,6 y 19,7 ya faltaba el principio de la frase).
export const duracionCreible = (texto, segundos) => { const v = texto.length / segundos; return v >= 8 && v <= 17; };

// Lee un WAV PCM de 16 bits y un canal, como los que entrega Voice Studio. Devuelve muestras entre -1 y 1.
export function leerWav(buffer) {
  const v = new DataView(buffer);
  const etiqueta = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buffer.byteLength < 12 || etiqueta(0) !== "RIFF" || etiqueta(8) !== "WAVE") throw new Error("no es un WAV");
  let frecuencia = 0, audio = null;
  for (let o = 12; o + 8 <= buffer.byteLength; ) {
    const id = etiqueta(o), n = v.getUint32(o + 4, true), ini = o + 8;
    if (id === "fmt ") {
      if (v.getUint16(ini, true) !== 1 || v.getUint16(ini + 2, true) !== 1 || v.getUint16(ini + 14, true) !== 16) throw new Error("el WAV debe ser PCM de 16 bits y un canal");
      frecuencia = v.getUint32(ini + 4, true);
    }
    if (id === "data") {
      const total = Math.floor(Math.min(n, buffer.byteLength - ini) / 2);
      audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = v.getInt16(ini + i * 2, true) / 32768;
    }
    o = ini + n + (n % 2); // los bloques de tamaño impar llevan un byte de relleno
  }
  if (!frecuencia || !audio?.length) throw new Error("WAV sin formato o sin audio");
  return { audio, frecuencia };
}
