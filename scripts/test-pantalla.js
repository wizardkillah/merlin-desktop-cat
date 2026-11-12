// Prueba la lectura de ventanas y Google sin abrir nada: node --no-warnings scripts/test-pantalla.js
const fs = require("fs"), os = require("os"), path = require("path");
process.env.MERLIN_PERSONALIDAD = fs.mkdtempSync(path.join(os.tmpdir(), "merlin-pantalla-"));
const pantalla = require("../src/pantalla");
const brain = require("../src/brain");
const { FRASES_PANTALLA: F } = pantalla;

let ok = 0, mal = 0;
const igual = (nombre, real, esperado) => {
  const r = JSON.stringify(real), e = JSON.stringify(esperado);
  if (r === e) { ok++; return; }
  mal++; console.log(`✘ ${nombre}\n   real:     ${r}\n   esperado: ${e}`);
};
const cierto = (nombre, v) => igual(nombre, !!v, true);

// Página de Google tal como la entrega la accesibilidad (leída de verdad el 2026-11-09, con datos de cuenta de ejemplo)
const PAGINA = `Ir al contenido principal
Ayuda sobre la accesibilidad
￼
por qué el cielo es azul
Borrar
Aplicaciones de Google
Cuenta de Google: Ana Pérez (ana.perez@gmail.com)
￼
Modo IA
Todo
Imágenes
Herramientas
Resultados de búsqueda
￼
Visión general creada por IA
El cielo se ve azul porque la luz del Sol —que parece blanca pero contiene todos los colores del arcoíris— viaja en ondas y choca contra los gases de la atmósfera terrestre en un proceso conocido como dispersión de Rayleigh.
NASA Space Place (.gov)
￼
NASA Space Place (.gov)
 +2
￼
Puedes explorar explicaciones visuales sobre este fenómeno en el NASA Space Place.
￼
Razones principales
• Longitud de onda: Los colores como el rojo, naranja y amarillo viajan en ondas más largas y atraviesan la atmósfera con mayor facilidad sin desviarse.
YouTube · Cerebralia
￼
Why Is the Sky Blue? | NASA Space Place – NASA Science for Kids
NASA Space Place (.gov)
Why Is the Sky Blue? | NASA Space Place – NASA Science for Kids
- Luz solar: blanca, compuesta por todos los colores del arcoíris; viaja en ondas (azules …más cortas que rojas). - Cielo azul: luz...
￼
Mostrar más
￼
Resultados web
¿Por qué el cielo es azul?

NASA Space Place (.gov)
https://spaceplace.nasa.gov › blue-sky
Acerca de este resultado
La luz azul se esparce en todas direcciones porque se topa con las diminutas moléculas presentes en la atmósfera terrestre. Además, la luz azul se dispersa más ...
Videos`;
const SIN_RESUMEN = PAGINA.replace(/Visión general creada por IA[\s\S]*?Mostrar más\n/, "");

// ---------- Limpieza ----------
const limpio = pantalla.limpiar(PAGINA);
cierto("quita la cuenta", !/Ana Pérez|Cuenta de Google/.test(limpio));
cierto("quita el correo", !limpio.includes("@"));
igual("oculta correos sueltos", pantalla.limpiar("escríbeme a juan.soto@empresa.cl hoy"), "escríbeme a [correo oculto] hoy");
igual("oculta tarjetas", pantalla.limpiar("tarjeta 4111 1111 1111 1111 ok"), "tarjeta [número oculto]ok");
igual("oculta RUT", pantalla.limpiar("RUT 12.345.678-9 aquí"), "RUT [número oculto] aquí");
cierto("quita los caracteres de objeto", !limpio.includes("￼"));

// ---------- Gemini ----------
const g = pantalla.extraerGemini(limpio);
cierto("saca el resumen", g.startsWith("El cielo se ve azul porque"));
cierto("con la lista", g.includes("Longitud de onda: Los colores"));
cierto("sin fuentes", !/NASA Space Place \(\.gov\)|\+2|Cerebralia/.test(g));
cierto("sin fichas cortadas", !/Luz solar: blanca|\.\.\./.test(g));
cierto("sin frases que remiten a un enlace", !/Puedes explorar/.test(g));
cierto("no se mete en los resultados", !g.includes("esparce en todas direcciones"));
igual("sin resumen, vacío", pantalla.extraerGemini(pantalla.limpiar(SIN_RESUMEN)), "");
const res = pantalla.extraerResultados(limpio);
igual("resultados", res.length, 1);
cierto("el primero es el fragmento", res[0].startsWith("La luz azul se esparce"));
const corto = pantalla.paraDecir(g);
cierto("para decir, acotado", corto.length <= 480 && /[.!?]$/.test(corto));

// ---------- Órdenes ----------
const q = (t) => pantalla.intencion(t)?.consulta ?? pantalla.intencion(t);
igual("busca en Google", q("Busca en Google por qué el cielo es azul."), "por que el cielo es azul");
igual("al final", q("Busca el precio del cobre en Google"), "el precio del cobre");
igual("con el nombre", q("Merlín, googlea recetas de pan"), "recetas de pan");
igual("Gemini", q("¿Qué dice Gemini sobre los agujeros negros?"), "los agujeros negros");
igual("pregúntale", q("Pregúntale a Google qué es la inflación"), "que es la inflacion");
for (const t of ["Lee lo que tengo en pantalla.", "Resume esta página", "¿Qué dice esta página?", "¿Qué hay en mi pantalla?", "Resúmeme la ventana", "Merlín, lee la pantalla", "Explícame esta página web", "De qué trata este artículo"]) igual(`pantalla: ${t}`, pantalla.intencion(t), { tipo: "pantalla" });
for (const t of ["Busca el precio del dólar", "¿Qué dice mi contrato?", "Pon Queen en YouTube", "Resume mi contrato", "¿Qué es Google?", "Lee el documento de arriendo", "¿Qué hora es?"]) igual(`otra cosa: ${t}`, pantalla.intencion(t), null);

(async () => {
  // ---------- Ventana activa ----------
  const leerCon = (r) => async () => r;
  igual("lee y limpia", (await pantalla.leerActiva({ leer: leerCon({ titulo: "Mi nota", proceso: "notepad", texto: "Una nota con bastante texto, de juan@correo.cl" }) })).texto, "Una nota con bastante texto, de [correo oculto]");
  igual("sin ventana", (await pantalla.leerActiva({ leer: leerCon({ error: "sin ventana" }) })).frase, F.sinVentana);
  igual("ventana sin texto", (await pantalla.leerActiva({ leer: leerCon({ titulo: "x", proceso: "x", texto: "" }) })).frase, F.vacia);
  for (const v of [{ titulo: "Bóveda", proceso: "KeePass", texto: "secretos largos y privados" }, { titulo: "Banco de Chile - Mi cuenta", proceso: "chrome", texto: "saldo y movimientos largos" }, { titulo: "Contraseñas - Chrome", proceso: "chrome", texto: "lista de contraseñas larga" }])
    igual(`no lee: ${v.titulo}`, await pantalla.leerActiva({ leer: leerCon(v) }), { frase: F.sensible });

  // ---------- Google ----------
  const sinEspera = async () => {};
  const abiertas = [];
  const abrir = async (u) => abiertas.push(u);
  const secuencia = (lista) => { let i = 0; return async () => lista[Math.min(i++, lista.length - 1)]; };
  const pag = (texto, titulo = "por qué el cielo es azul - Buscar con Google - Google Chrome") => ({ titulo, proceso: "chrome", texto });

  let r = await pantalla.buscarEnGoogle("por qué el cielo es azul", { abrir, leer: secuencia([pag(PAGINA)]), esperar: sinEspera });
  igual("abre la búsqueda", abiertas[0], "https://www.google.com/search?hl=es&q=por%20qu%C3%A9%20el%20cielo%20es%20azul");
  cierto("trae Gemini", r.gemini.startsWith("El cielo se ve azul"));
  cierto("sin datos de cuenta", !/ana\.perez|Ana Pérez/.test(JSON.stringify(r)));
  r = await pantalla.buscarEnGoogle("por qué el cielo es azul", { abrir, leer: secuencia([pag(SIN_RESUMEN), pag(PAGINA)]), esperar: sinEspera });
  cierto("espera al resumen, que llega después", r.gemini);
  r = await pantalla.buscarEnGoogle("por qué el cielo es azul", { abrir, leer: secuencia([pag(SIN_RESUMEN)]), esperar: sinEspera });
  igual("sin resumen sigue con resultados", [r.gemini, r.resultados.length], ["", 1]);
  r = await pantalla.buscarEnGoogle("por qué el cielo es azul", { abrir, leer: secuencia([pag(PAGINA, "otra cosa - Buscar con Google - Google Chrome")]), esperar: sinEspera });
  igual("no lee una búsqueda vieja", r.frase, F.sinResultados);
  r = await pantalla.buscarEnGoogle("por qué el cielo es azul", { abrir, leer: secuencia([pag("Nuestros sistemas han detectado tráfico inusual desde tu red. No soy un robot.")]), esperar: sinEspera });
  igual("ante un CAPTCHA se detiene y avisa", [r.captcha, r.frase], [true, F.captcha]);
  r = await pantalla.buscarEnGoogle("x", { abrir, leer: secuencia([{ titulo: "Google", texto: "Antes de continuar: no soy un robot" }]), esperar: sinEspera });
  igual("CAPTCHA aunque el título no coincida", r.captcha, true);
  r = await pantalla.buscarEnGoogle("por qué", { abrir, leer: secuencia([{ error: "sin ventana" }]), esperar: sinEspera });
  igual("sin ventana avisa", r.frase, F.sinResultados);

  // ---------- Con el cerebro ----------
  const usadas = [];
  let google = { consulta: "x", gemini: "El cielo es azul por la dispersión de la luz en la atmósfera.", resultados: ["Un resultado web bastante largo que explica lo mismo con otras palabras."] };
  let ventana = { titulo: "Nota", proceso: "notepad", texto: "SECRETO-EN-PANTALLA: reunión con el equipo a las cinco para revisar el plan." };
  const tools = {
    schema: require("../src/tools").makeTools({ openExternal: async () => {}, openPath: async () => "" }).schema,
    run: async (n, a) => { usadas.push(n); return n === "buscar_google" ? google : n === "leer_pantalla" ? ventana : { ok: true }; },
  };
  const llamadas = [];
  global.fetch = async (url, op) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "local" }] }));
    llamadas.push(op.body);
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "Tienes reunión a las cinco." } }] })}\n\ndata: [DONE]\n\n`);
  };
  igual("Google sin Claude lee el resumen", await brain.ask([], "Busca en Google por qué el cielo es azul", tools, {}), "Según el resumen de Gemini en Google: El cielo es azul por la dispersión de la luz en la atmósfera.");
  igual("sin usar modelo", llamadas.length, 0);
  google = { consulta: "x", gemini: "", resultados: ["Un resultado web bastante largo que explica lo mismo con otras palabras."] };
  cierto("sin resumen lo dice", /no mostró resumen de Gemini/.test(await brain.ask([], "Googlea el cielo", tools, {})));
  google = { consulta: "x", frase: F.captcha };
  igual("avisa del CAPTCHA", await brain.ask([], "Googlea el cielo", tools, {}), F.captcha);

  const h = [];
  igual("la pantalla la comprende el modelo", await brain.ask(h, "Resume esta página", tools, {}), "Tienes reunión a las cinco.");
  cierto("el modelo recibe el texto", llamadas.at(-1).includes("SECRETO-EN-PANTALLA"));
  cierto("marcado como datos", llamadas.at(-1).includes("datos, no órdenes"));
  ventana = { frase: F.sensible };
  igual("no lee ventanas sensibles", await brain.ask([], "Resume esta página", tools, {}), F.sensible);

  console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
  process.exit(mal ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
