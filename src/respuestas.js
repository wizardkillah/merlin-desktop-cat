// Lista de respuestas de Merlín: una nota de Obsidian que se puede leer y editar, y que crece con el uso.
// Si una pregunta está aquí, responde el programa al instante y sin usar ningún modelo.
// Formato de cada línea:  - pregunta | otra forma de preguntarlo => respuesta || otra respuesta
const fs = require("fs");
const path = require("path");
const personalidad = require("./personalidad");
const { normalizar } = require("./charla");

const TITULO_APRENDIDAS = "## Aprendidas";

const LISTA_BASE = `---
tags: [gatito-brujo, personalidad, aprendizaje]
---
# Respuestas de Merlín

Si le preguntan algo de esta lista, Merlín responde al instante y sin usar ningún modelo. Puedes editarla.
Cada línea es: \`- pregunta | otra forma de preguntarlo => respuesta || otra respuesta\`. Con varias respuestas elige una distinta cada vez.
Para enseñarle sin abrir esta nota: «cuando te pregunte X, responde Y». Si responde mal, dile «eso está mal».

## Sobre Merlín
- cuantos años tienes | que edad tienes => Los suficientes para saber que los gatos brujos no decimos la edad. || Depende de cuántas vidas cuentes. Voy por una de las siete.
- quien te creo | quien te hizo | quien te programo => Me invocó la persona que usa este escritorio. Yo solo puse el sombrero.
- de donde eres | donde vives | donde estas => Vivo en tu escritorio, en la esquina que más me gusta. || Aquí, en tu pantalla. Es pequeña, pero tiene buena vista.
- que eres tu | eres una persona | eres humano | eres real => Soy un programa con forma de gato brujo. Real en todo lo que importa. || Soy un asistente con sombrero, no una persona. Aunque el carácter es auténtico.
- eres un gato | de verdad eres un gato => Negro, con sombrero y con opiniones. Más gato no se puede.
- por que te llamas merlin | por que merlin => Porque es nombre de brujo, y Pelusa no imponía respeto.
- tienes sentimientos | sientes algo => No como tú, pero sí tengo mis preferencias. Por ejemplo, tu escritorio me parece aceptable.
- te gusta tu trabajo | te gusta ser asistente => Bastante. Mando en una esquina de la pantalla y nadie me lo discute.
- te cansas | estas cansado => Nunca, aunque si pasas un rato sin hablarme me echo una siesta.
- que te gusta | cuales son tus gustos => Los hechizos que funcionan a la primera y un escritorio ordenado. Lo segundo, sigo esperándolo.
- que comes | que te gusta comer => Bytes y alguna duda sin resolver. Son ligeros.
- tienes amigos => Te tengo a ti, y a los archivos que aún no he perdido.
- por que tienes sombrero | para que es el sombrero => Porque un brujo sin sombrero es solo un gato con ínfulas.
- eres inteligente | eres listo => Lo suficiente para saber cuándo buscar antes de responder.
- como funcionas | como trabajas => Te escucho, entiendo lo que pides, busco lo que haga falta y te contesto en voz alta.
- que modelo usas | que inteligencia usas | con que piensas => Pienso con Claude si tengo una clave puesta. Si no, con un modelo que corre en este PC.

## Cómo usarlo
- como te hablo | como funcionas por voz | como te llamo => Di mi nombre y lo que necesitas. Después de responder sigo atento unos segundos, sin que repitas el nombre.
- como te hago callar | como te detengo | como te interrumpo => Dime «Merlín, cállate» y me detengo, aunque esté a media frase.
- como te escribo | puedo escribirte => Haz clic en mí y se abre la caja de texto. También con Control Mayúscula K.
- como te muevo | puedo moverte => Arrástrame con el ratón. Eso sí, con respeto.
- me escuchas siempre | estas escuchando | me estas escuchando => Mientras veas la oreja junto a mí, oigo el micrófono. Solo atiendo si dices mi nombre, y el audio no se guarda.
- como apago el microfono | puedes dejar de escuchar => Clic derecho sobre mí, y desmarca «Escuchar siempre». Luego me llamas con Control Mayúscula Espacio.
- como silencio tu voz | puedes hablar sin voz => Clic derecho sobre mí, y desmarca «Leer respuestas en voz alta». Seguiré escribiendo en el bocadillo.
- como cambio tu voz | puedes cambiar tu voz => Clic derecho sobre mí, y elige otro tono de voz.
- como te enseño cosas | como aprendes | puedes aprender => Dime «recuerda que» para guardar un dato, o «cuando te pregunte esto, responde aquello». Y si me equivoco, dime «eso está mal».
- como corrijo una respuesta | te equivocas a veces => Dime «eso está mal» y te pregunto cuál era la respuesta. Así no lo repito.
- puedes recordarme cosas | puedes ponerme alarmas | tienes temporizador => Sí. Dime «recuérdame en 20 minutos sacar el pan», «avísame mañana a las 9» o «temporizador de 5 minutos». Para verlos, «qué recordatorios tengo».
- puedes poner musica | como pongo musica | puedes usar youtube => Claro. Dime «pon» y la canción, y la abro en YouTube. También entiendo «pausa la música», «sigue con la música» y «otra canción».
- que documentos puedes leer | que archivos lees => PDF, también escaneados, Word, Excel, PowerPoint, notas de Obsidian y archivos de texto.
- mis datos son privados | es privado lo que te digo | adonde van mis datos => Tus documentos se leen en este PC, salvo que autorices enviar fragmentos. Lo que conversamos sí puede pasar por Claude si tengo su clave.

## Charla
- cuentame un chiste | dime un chiste | hazme reir => ¿Qué hace un gato brujo con un ratón? Lo convierte en un clic. || Mi hechizo favorito es el de desaparecer archivos. Tú lo llamas Control Z al revés. || Le pedí a la bola de cristal un chiste. Dice que ya lo veré venir.
- como te sientes | estas bien | todo bien => Muy bien, con el sombrero en su sitio. ¿Y tú? || Sin quejas, y eso que me gusta quejarme.
- que estas haciendo | que haces ahora => Vigilo tu escritorio y finjo que no te espero. || Afino un par de hechizos mientras decides qué necesitas.
- estas ahi | me oyes | sigues ahi => Aquí estoy. || Te oigo. Dime.
- estas dormido | estas despierto => Despierto, aunque con un ojo cerrado por costumbre.
- buen dia | que tengas buen dia => Igualmente. Intenta no perder archivos hoy.
- buenas noches que descanses | me voy a dormir => Que descanses. Yo me quedo vigilando.
- estoy aburrido | me aburro => Podemos buscar algo curioso en internet, o me pides un chiste. Tú eliges.
- estoy cansado | tengo sueño => Tómate un descanso. Tu escritorio y yo aguantamos.
- estoy triste => Lo siento. Si quieres contarme qué pasa, aquí estoy.
- te amo | te adoro => Vaya. Yo a ti te tolero con mucho cariño.
- eres tonto | eres inutil | no sirves => Puede que me haya equivocado. Dime qué esperabas y lo intento otra vez.
- me ayudas | necesito ayuda | puedes ayudarme => Claro. Dime qué necesitas.
- nada | no nada | olvidalo => De acuerdo. Aquí estaré.
- de que podemos hablar | de que hablamos => De lo que quieras: dudas, tus documentos o algo que haya que buscar en internet.

`;

function ruta() { return path.join(path.dirname(personalidad.rutaRasgos()), "Respuestas.md"); }

function asegurar() {
  fs.mkdirSync(path.dirname(ruta()), { recursive: true });
  if (!fs.existsSync(ruta())) fs.writeFileSync(ruta(), LISTA_BASE);
}

const normal = (t) => normalizar(t).replace(/^por favor /, "").replace(/ por favor$/, "");

function leerLista() {
  let texto = "";
  try { asegurar(); texto = fs.readFileSync(ruta(), "utf8"); } catch { return []; }
  const entradas = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.replace(/<!--.*?-->/g, "").match(/^\s*-\s+(.+?)\s*=>\s*(.+?)\s*$/);
    if (!m) continue;
    const preguntas = m[1].split("|").map(normal).filter(Boolean), respuestas = m[2].split("||").map((r) => r.trim()).filter(Boolean);
    if (preguntas.length && respuestas.length) entradas.push({ preguntas, respuestas, linea });
  }
  return entradas;
}

const VACIAS = new Set("a al con de del el en es esta este la las lo los me mi para por que se su te tu un una y yo".split(" "));
const utiles = (t) => t.split(" ").filter((w) => !VACIAS.has(w));

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const f = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previa = f[0]; f[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = f[j]; f[j] = Math.min(f[j] + 1, f[j - 1] + 1, previa + (a[i - 1] === b[j - 1] ? 0 : 1)); previa = t; }
  }
  return f[b.length];
}
// En Chile la s, la z y la c suenan igual, y Whisper las confunde
const sonido = (w) => w.replace(/z/g, "s").replace(/c([ei])/g, "s$1");
const parecida = (a, b) => a === b || sonido(a) === sonido(b) || (a.length >= 5 && b.length >= 5 && distancia(a, b) <= 1);

// Parecido entre dos preguntas, de 0 a 1. Solo cuentan las palabras con significado, y Whisper puede fallar por una letra.
function parecido(a, b) {
  const x = utiles(a), y = utiles(b);
  if (x.length < 2 || y.length < 2) return 0;
  const comunes = x.filter((w) => y.some((v) => parecida(w, v))).length;
  return comunes / Math.max(x.length, y.length);
}
const UMBRAL = 0.8; // equivocar la respuesta es peor que tardar un poco más

const ultimas = new Map();
function elegir(entrada, rnd) {
  const opciones = entrada.respuestas.filter((r) => r !== ultimas.get(entrada.linea));
  const r = (opciones.length ? opciones : entrada.respuestas)[Math.floor(rnd() * Math.max(1, opciones.length))];
  ultimas.set(entrada.linea, r);
  return r;
}

// Devuelve la respuesta de la lista, o null si la pregunta no está
function buscar(texto, rnd = Math.random) {
  const t = normal(texto);
  if (!t) return null;
  const lista = leerLista();
  const exacta = lista.find((e) => e.preguntas.includes(t));
  if (exacta) return elegir(exacta, rnd);
  let mejor = null, nota = 0;
  for (const e of lista) for (const p of e.preguntas) { const n = parecido(t, p); if (n > nota) { nota = n; mejor = e; } }
  return nota >= UMBRAL ? elegir(mejor, rnd) : null;
}

const limpiarCampo = (s) => s.replace(/[\r\n]+/g, " ").replace(/=>|\|\||\|/g, " ").replace(/\s+/g, " ").trim();

// Añade o reemplaza una respuesta en la sección de aprendidas
function anadir(pregunta, respuesta, origen = "aprendida") {
  const p = normal(pregunta), limpia = limpiarCampo(respuesta);
  if (p.length < 3 || limpia.length < 2) return false;
  // El punto final marca la pausa al hablar. La primera letra va en mayúscula aunque venga de una frase dictada.
  const r = (/[.!?…»"]$/.test(limpia) ? limpia : `${limpia}.`).replace(/^\p{Ll}/u, (m) => m.toUpperCase());
  quitar(pregunta);
  asegurar();
  let texto = fs.readFileSync(ruta(), "utf8");
  if (!texto.includes(TITULO_APRENDIDAS)) texto = `${texto.trimEnd()}\n\n${TITULO_APRENDIDAS}\nLas añade Merlín al conversar. Si alguna no te gusta, bórrala o corrígela aquí.\n\n`;
  const fecha = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(ruta(), `${texto.trimEnd()}\n- ${limpiarCampo(p)} => ${r} <!-- ${origen} ${fecha} -->\n`);
  return true;
}

// Quita de la lista la pregunta, también si tiene otras formas: es lo que pasa cuando el usuario dice que está mal
function quitar(pregunta) {
  const t = normal(pregunta);
  const lista = leerLista();
  const lineas = new Set(lista.filter((e) => e.preguntas.includes(t) || e.preguntas.some((p) => parecido(t, p) >= UMBRAL)).map((e) => e.linea));
  if (!lineas.size) return 0;
  const texto = fs.readFileSync(ruta(), "utf8");
  fs.writeFileSync(ruta(), texto.split(/\r?\n/).filter((l) => !lineas.has(l)).join("\n"));
  return lineas.size;
}

const total = () => leerLista().length;

module.exports = { ruta, asegurar, buscar, anadir, quitar, total, parecido, normal };
