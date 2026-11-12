// Leer lo que hay en pantalla y buscar en Google con el navegador del usuario. Solo lee: no hace clics ni escribe.
// Google arma sus resultados con JavaScript, así que una petición directa no trae nada: se abre la búsqueda en el
// navegador y se lee esa ventana con la accesibilidad de Windows, la misma vía de un lector de pantalla.
const path = require("path");
const { execFile } = require("child_process");
const { normalizar } = require("./charla");

const SCRIPT = path.join(__dirname, "..", "scripts", "leer-ventana.ps1");
const LIMITE_MS = 20000, MAX_TEXTO = 6000;
const ESPERA_ABRIR_MS = 2500, ESPERA_REINTENTO_MS = 1800, INTENTOS_GOOGLE = 4;

const FRASES_PANTALLA = {
  sinVentana: "No encuentro ninguna ventana que leer.",
  vacia: "Esa ventana no me deja leer su texto.",
  sensible: "Esa ventana parece de contraseñas o de un banco, así que no la leo.",
  captcha: "Google me pide comprobar que no soy un robot. Resuélvelo en el navegador y me lo vuelves a pedir.",
  sinResultados: "Abrí la búsqueda en tu navegador, pero no logré leer los resultados.",
};

// Ventanas que no se leen aunque lo pidan
const PROCESO_SENSIBLE = /keepass|1password|bitwarden|lastpass|dashlane|nordpass|enpass/i;
const TITULO_SENSIBLE = /\b(banco|bank|bci|santander|scotiabank|bancoestado|itau|falabella|webpay|transbank|mercado ?pago|paypal|contrase[nñ]as?|passwords?|gestor de claves)\b/i;

// Ventanas que muestran documentos o correo del usuario: su texto es tan privado como el de sus archivos y,
// sin el permiso de enviar documentos, no sale hacia Claude. Una página web normal sí puede ir.
const PROCESO_PRIVADO = /^(?:acrord32|acrobat|foxit\w*|sumatrapdf|pdfxedit|winword|excel|powerpnt|onenote|soffice\w*|wordpad|notepad|notepad\+\+|obsidian|code|outlook|olk|hxoutlook|thunderbird|mailspring)(?:\.exe)?$/i;
const TITULO_PRIVADO = /\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|rtf|txt|md|csv)\b|\b(?:gmail|outlook|hotmail|correo|bandeja de entrada|inbox|whatsapp|telegram)\b|^file:/i;
const esPrivada = (r = {}) => PROCESO_PRIVADO.test(r.proceso || "") || TITULO_PRIVADO.test(r.titulo || "");

// Lo que no debe salir de aquí aunque esté en pantalla: la cuenta del navegador, correos, tarjetas y RUT
function limpiar(texto) {
  return texto
    .replace(/[￼￼​]/g, "")
    .replace(/^.*(?:Cuenta de Google|Google Account).*$/gim, "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo oculto]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[número oculto]")
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g, "[número oculto]")
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("\n");
}

function leerVentana({ titulo = "" } = {}) {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT];
  if (titulo) args.push("-Titulo", titulo);
  return new Promise((ok) => execFile("powershell.exe", args, { windowsHide: true, timeout: LIMITE_MS, maxBuffer: 1 << 24, encoding: "utf8" }, (e, salida) => {
    if (e) return ok({ error: e.message });
    try { ok(JSON.parse(salida.trim())); } catch { ok({ error: "respuesta ilegible" }); }
  }));
}

// La ventana activa, ya limpia. Devuelve { titulo, proceso, texto } o { frase } si hay algo que decirle al usuario.
async function leerActiva({ leer = leerVentana } = {}) {
  const r = await leer();
  if (r.error) return { frase: FRASES_PANTALLA.sinVentana, error: r.error };
  if (PROCESO_SENSIBLE.test(r.proceso || "") || TITULO_SENSIBLE.test(r.titulo || "")) return { frase: FRASES_PANTALLA.sensible };
  const texto = limpiar(r.texto || "");
  if (texto.length < 20) return { frase: FRASES_PANTALLA.vacia };
  return { titulo: limpiar(r.titulo || ""), proceso: r.proceso, texto: texto.slice(0, MAX_TEXTO) };
}

const MARCA_GEMINI = /^(?:Visi[oó]n general creada por IA|Vista creada con IA|Resumen de IA|Resumen creado por IA|Descripci[oó]n general creada por IA|AI Overview)$/im;
const FIN_GEMINI = /^(?:Mostrar m[aá]s|Resultados web|Web results|M[aá]s resultados|La IA puede cometer errores.*|Las respuestas de la IA.*|AI responses may.*|Comentarios)$/im;
const INICIO_RESULTADOS = /^(?:Resultados web|Web results)$/im, INICIO_BUSQUEDA = /^(?:Resultados de b[uú]squeda|Search Results)$/im;

// Resultados y resumen vienen mezclados con fuentes, títulos y fichas cortadas: solo sirven las frases de verdad
const esFraseUtil = (l) => l.length >= 35 && !/[…]|\.\.\.$/.test(l) && !/\s[|｜·]\s/.test(l) && !/^https?:/.test(l) && !/^Acerca de este resultado/i.test(l) && /[.!?:;]$|\s\S+\s\S+\s\S+\s/.test(l) && !/\(\.[a-z]{2,4}\)$/.test(l);

// «Puedes explorar…en el NASA Space Place»: remite a un enlace que en voz alta no se puede seguir
const REMITE = /^(?:Puedes|Podr[aá]s|Consulta|Visita|Explora|Para m[aá]s)\b.*\b(?:en el|en la|en los|en|art[ií]culo|portal|sitio|p[aá]gina|enlace)\b/i;

function extraerGemini(texto) {
  const m = texto.match(MARCA_GEMINI);
  if (!m) return "";
  const resto = texto.slice(m.index + m[0].length);
  const fin = resto.search(FIN_GEMINI);
  return (fin >= 0 ? resto.slice(0, fin) : resto.slice(0, 2500))
    .split("\n").map((l) => l.replace(/^[•\-–]\s*/, "").trim()).filter(esFraseUtil).filter((l) => /[.!?:;]$/.test(l))
    .filter((l) => !REMITE.test(l)).join(" ").trim();
}

function extraerResultados(texto, max = 3) {
  let i = texto.search(INICIO_RESULTADOS);
  if (i < 0) i = texto.search(INICIO_BUSQUEDA);
  if (i < 0) return [];
  // Las fichas con «…» o «...» al final son los resúmenes de los resultados: aquí sí valen
  return texto.slice(i).split("\n").slice(1).filter((l) => l.length >= 60 && !/^https?:/.test(l) && !/^Acerca de/i.test(l) && !/\s[|｜]\s/.test(l)).slice(0, max);
}

const CAPTCHA = /tr[aá]fico inusual|unusual traffic|no soy un robot|i'?m not a robot|recaptcha/i;

// Un trozo que se pueda decir en voz alta: tres frases, cortas
function paraDecir(texto, frases = 3, max = 420) {
  const partes = texto.match(/.+?[.!?](?=\s|$)/g) || [texto];
  let salida = "";
  for (const f of partes.slice(0, frases)) { if ((salida + f).length > max && salida) break; salida += f; }
  return salida.trim().slice(0, max + 60);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// El título de la pestaña lleva la búsqueda: así no se lee por error una búsqueda vieja de otra ventana
const esLaBusqueda = (titulo, consulta) => normalizar(titulo).includes(normalizar(consulta).slice(0, 40));

async function buscarEnGoogle(consulta, { abrir, leer = leerVentana, esperar = espera }) {
  const q = (consulta || "").trim();
  if (!q) return { error: "Falta indicar qué buscar." };
  await abrir(`https://www.google.com/search?hl=es&q=${encodeURIComponent(q)}`);
  await esperar(ESPERA_ABRIR_MS);
  let texto = "", gemini = "";
  for (let i = 0; i < INTENTOS_GOOGLE; i++) {
    const r = await leer({ titulo: "Google" });
    if (!r.error && esLaBusqueda(r.titulo || "", q)) {
      texto = limpiar(r.texto || "");
      if (CAPTCHA.test(texto)) return { consulta: q, captcha: true, frase: FRASES_PANTALLA.captcha };
      gemini = extraerGemini(texto);
      if (gemini) break; // el resumen llega después que los resultados: se le da un momento antes de seguir sin él
    } else if (!r.error && CAPTCHA.test(`${r.titulo} ${r.texto}`)) return { consulta: q, captcha: true, frase: FRASES_PANTALLA.captcha };
    if (i < INTENTOS_GOOGLE - 1) await esperar(ESPERA_REINTENTO_MS);
  }
  const resultados = extraerResultados(texto);
  if (!gemini && !resultados.length) return { consulta: q, frase: FRASES_PANTALLA.sinResultados };
  return { consulta: q, gemini, resultados, texto: texto.slice(0, MAX_TEXTO) };
}

// Órdenes claras. Devuelve { tipo: "google", consulta } | { tipo: "pantalla" } | null
const VERBOS = "(?:busca|buscame|buscar|investiga|consulta|mira|averigua)";
const GOOGLE_FIN = new RegExp(`^${VERBOS} (.+?) (?:en|por|con) google$`);
const GOOGLE_INICIO = new RegExp(`^(?:${VERBOS} (?:en|por|con) google|(?:en|por) google ${VERBOS}) (.+)$`);
const GOOGLEA = /^(?:googlea|googlear|guglea|gugulea) (.+)$/;
const QUE_DICE = /^(?:que dice|que opina|que responde|preguntale a|pregunta a|preguntale) (?:a )?(?:google|gemini|jemini|yemini)(?: (?:sobre|de|acerca de|por))? (.+)$/;
const PANTALLA = /^(?:lee|leeme|lee en voz alta|resume|resumeme|explicame|que dice|que pone|que hay en|que ves en|de que (?:trata|habla)|mira)(?: (?:lo que|todo lo que) (?:hay|tengo|sale|aparece|ves|dice|pone)(?: en)?)? (?:la |mi |esta |este |el |lo que hay en )?(?:pantalla|ventana|pagina|pagina web|web|sitio|articulo)(?: (?:que tengo )?abiert[oa]| activa)?$/;
const QUE_TENGO = /^que (?:tengo|hay|ves) en (?:la |mi )?(?:pantalla|ventana)$/;

function intencion(texto) {
  const t = normalizar(texto);
  if (!t) return null;
  if (PANTALLA.test(t) || QUE_TENGO.test(t)) return { tipo: "pantalla" };
  const m = t.match(GOOGLE_FIN) || t.match(GOOGLE_INICIO) || t.match(GOOGLEA) || t.match(QUE_DICE);
  return m ? { tipo: "google", consulta: m[1].trim() } : null;
}

module.exports = { FRASES_PANTALLA, esPrivada, limpiar, leerActiva, leerVentana, buscarEnGoogle, extraerGemini, extraerResultados, paraDecir, intencion };
