// Charla corta que responde el programa, al instante y con la voz grabada de Merlín, sin pasar por el modelo.
// Solo cuenta si el mensaje es únicamente eso: «hola, ¿qué dice mi contrato?» sigue yendo al modelo.
// «sí», «no», «ok» o «vale» no están a propósito: su sentido depende de lo que se acaba de preguntar.
// Las respuestas se graban con npm run voz:pregrabar; hasta entonces, o si se cambian, las dice Piper.
const INTENCIONES = [
  {
    patron: /^(hola|holi|hey|buenas|buenos dias|buenas tardes|buenas noches|hola hola)$/,
    respuestas: ["Hola. Aquí sigo, dominando tu escritorio. ¿En qué te ayudo?", "Vaya, hola. Justo estaba afilando mis hechizos. ¿Qué necesitas?", "Buenas. Tienes a un brujo disponible, cosa rara. ¿Qué se te ofrece?"],
  },
  {
    patron: /^((hola )?(que tal|como estas|como estai|como te va|como andas|como vas|como te encuentras))$/,
    respuestas: ["Pues aquí, dominando el escritorio, como siempre. ¿En qué te ayudo?", "De maravilla. Ser un gato brujo tiene sus ventajas. ¿Y tú, qué necesitas?", "Con el sombrero bien puesto y la magia a punto. ¿Qué hacemos?"],
  },
  {
    patron: /^(quien eres|que eres|como te llamas|cual es tu nombre|presentate)$/,
    respuestas: ["Soy Merlín, un gato brujo que vive en tu escritorio. Humilde no, pero útil sí.", "Merlín, para servirte. Gato negro, sombrero de brujo y demasiados poderes para una esquina de la pantalla.", "Me llamo Merlín. Soy el gato brujo de tu escritorio, y sí, el sombrero es mío."],
  },
  {
    patron: /^(que (puedes|sabes) hacer|que haces|en que me (puedes|podrias) ayudar|para que sirves|ayuda|ayudame)$/,
    respuestas: ["Busco en internet, leo webs, encuentro tus archivos y te digo qué pone en tus documentos. Tú pregunta.", "Puedo buscar en internet, abrir tus archivos, leer tus documentos y recordar lo que me pidas. Magia práctica, vamos.", "Rastreo archivos, reviso tus documentos y busco lo que haga falta en internet. ¿Por dónde empezamos?"],
  },
  {
    patron: /^((muchas |muchisimas |mil )?gracias( por todo| totales)?|te pasaste)$/,
    respuestas: ["De nada. Para eso llevo el sombrero.", "No hay de qué. Un brujo siempre cumple.", "A mandar. Cuando quieras, más magia."],
  },
  {
    patron: /^(adios|chao|chau|hasta luego|hasta pronto|hasta manana|nos vemos|me voy)$/,
    respuestas: ["Hasta luego. Yo me quedo vigilando el escritorio.", "Nos vemos. Aquí estaré, fingiendo que no te espero.", "Adiós. Cuidaré de tus archivos mientras no estás."],
  },
  {
    patron: /^(eres (genial|el mejor|increible|un crack|lo maximo)|buen trabajo|bien hecho|te quiero|me caes bien)$/,
    respuestas: ["Lo sé, pero sigue, no te detengas.", "Vaya, por fin alguien lo reconoce. Gracias.", "Tanto halago me va a agrandar el sombrero. Gracias."],
  },
  {
    patron: /^(miau+|prr+)$/,
    respuestas: ["Miau. Tu acento es terrible, pero te entiendo.", "¿Intentas hablar mi idioma? Qué detalle. Miau.", "Eso en gato significa: ¿en qué te ayudo?"],
  },
];

const RESPUESTAS_CHARLA = INTENCIONES.flatMap((i) => i.respuestas);

const normalizar = (texto) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim()
  .replace(/^((oye|hey) )?merlin /, "").replace(/ merlin$/, "");

const ultimas = new Map();
// Devuelve la respuesta si el mensaje es solo charla; si no, null. Nunca repite dos veces seguidas.
function responderCharla(texto, rnd = Math.random) {
  const t = normalizar(texto);
  const intencion = INTENCIONES.find((i) => i.patron.test(t));
  if (!intencion) return null;
  const opciones = intencion.respuestas.filter((r) => r !== ultimas.get(intencion));
  const elegida = opciones[Math.floor(rnd() * opciones.length)];
  ultimas.set(intencion, elegida);
  return elegida;
}

// Preguntas con respuesta exacta, que el programa calcula: no hace falta preguntarle a ningún modelo
const ES_HORA = /^(que hora es|que hora son|que horas son|que horas|que hora|dime la hora|me dices la hora|la hora)( ahora)?$/;
const ES_FECHA = /^(que dia es|que fecha es|que dia estamos|a que dia estamos|a que fecha estamos|en que dia estamos|dime la fecha|la fecha|que dia es hoy|que fecha es hoy|hoy que dia es)$/;
function responderDato(texto, ahora = new Date()) {
  const t = normalizar(texto);
  if (ES_HORA.test(t)) {
    const h24 = ahora.getHours(), m = ahora.getMinutes(), h = h24 % 12 || 12;
    const parte = h24 < 6 ? "de la madrugada" : h24 < 12 ? "de la mañana" : h24 < 20 ? "de la tarde" : "de la noche";
    return `${h === 1 ? "Es la" : "Son las"} ${h}${m ? ` y ${m}` : " en punto"} ${parte}.`;
  }
  if (ES_FECHA.test(t)) return `Hoy es ${ahora.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
  return null;
}

module.exports = { responderCharla, responderDato, normalizar, RESPUESTAS_CHARLA };
