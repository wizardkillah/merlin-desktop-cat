// Prueba las órdenes de música sin abrir nada: node --no-warnings scripts/test-musica.js
// Con --real además consulta YouTube de verdad (no abre el navegador).
const os = require("os"), fs = require("fs"), path = require("path");
process.env.MERLIN_PERSONALIDAD = fs.mkdtempSync(path.join(os.tmpdir(), "merlin-musica-"));
const musica = require("../src/musica");
const brain = require("../src/brain");

let ok = 0, mal = 0;
const igual = (nombre, real, esperado) => {
  const r = JSON.stringify(real), e = JSON.stringify(esperado);
  if (r === e) { ok++; return; }
  mal++; console.log(`✘ ${nombre}\n   real:     ${r}\n   esperado: ${e}`);
};

// ---------- Órdenes ----------
const rep = (t) => { musica.reiniciar(); const r = musica.intencion(t); return r?.tipo === "reproducir" ? r.consulta : r; };
igual("con YouTube", rep("Pon Bohemian Rhapsody en YouTube."), "bohemian rhapsody");
igual("busca en YouTube", rep("Busca una canción de Queen en YouTube"), "queen");
igual("con el nombre delante", rep("Merlín, reproduce La Bamba en YouTube"), "la bamba");
igual("YouTube primero", rep("En YouTube pon música de Los Prisioneros"), "los prisioneros");
igual("sin YouTube", rep("Pon la canción Gracias a la vida"), "gracias a la vida");
igual("música de", rep("Ponme música de Violeta Parra"), "violeta parra");
igual("quiero escuchar", rep("Quiero escuchar Thriller de Michael Jackson"), "thriller de michael jackson");
igual("reproduce", rep("Reproduce Despacito"), "despacito");
igual("Whisper separa You Tube", rep("Pon Shakira en You Tube"), "shakira");
igual("video", rep("Quiero ver un video de gatos en YouTube"), "gatos");
for (const t of ["¿Qué hora es?", "Pon un recordatorio para mañana", "Busca el precio del dólar", "¿Qué es YouTube?", "Abre mi currículum", "Para", "Sigue", "Pon el volumen más alto", "Quién canta Thriller"]) { musica.reiniciar(); igual(`no es música: ${t}`, musica.intencion(t), null); }
const ctl = (t) => { musica.reiniciar(); return musica.intencion(t)?.accion; };
for (const t of ["Pausa la música.", "Pausa.", "Para la música", "Detén el video", "Quita la música"]) igual(`pausar: ${t}`, ctl(t), "pausar");
for (const t of ["Sigue con la música.", "Continúa la canción", "Reanuda", "Quita la pausa"]) igual(`seguir: ${t}`, ctl(t), "seguir");
for (const t of ["Otra canción.", "Siguiente canción", "Pasa la canción", "Cambia de canción"]) igual(`siguiente: ${t}`, ctl(t), "siguiente");
musica.reiniciar();
igual("sin decir cuál", musica.intencion("Pon música").tipo, "pedir");
igual("la siguiente frase es la canción", musica.intencion("Los Jaivas"), { tipo: "reproducir", consulta: "los jaivas" });
igual("solo una vez", musica.intencion("Los Jaivas"), null);
musica.intencion("Pon música");
igual("otra pregunta no es la canción", musica.intencion("¿Qué hora es?"), null);
const t0 = Date.now(); musica.intencion("Pon una canción", t0);
igual("la espera caduca", musica.intencion("Los Jaivas", t0 + 120000), null);

// ---------- Títulos ----------
igual("quita lo que sobra", musica.tituloParaDecir("Queen - Bohemian Rhapsody (Official Video Remastered) [HD] | Topic"), "Queen - Bohemian Rhapsody");
igual("no deja vacío", musica.tituloParaDecir("(Live)"), "(Live)");

// ---------- Lectura de resultados ----------
const pagina = (videos) => `<script>var ytInitialData = ${JSON.stringify({ a: { b: [{ videoRenderer: { videoId: "EMISIONDIRE", title: { runs: [{ text: "En directo" }] } } }, ...videos.map((v) => ({ videoRenderer: { videoId: v[0], title: { runs: [{ text: v[1] }] }, lengthText: { simpleText: "5:55" }, ownerText: { runs: [{ text: "Canal" }] } } }))] } })};</script>`;
igual("salta los directos", musica.leerResultados(pagina([["fJ9rUzIMcZQ", "Bohemian"]])).map((v) => v.id), ["fJ9rUzIMcZQ"]);
igual("rechaza un id raro", musica.leerResultados(pagina([["../../evil", "Malo"]])), []);
igual("página desconocida", musica.leerResultados("<html>nada</html>"), []);
igual("JSON roto", musica.leerResultados("ytInitialData = {roto};</script>"), []);

(async () => {
  // ---------- Reproducir ----------
  const abiertas = [];
  const abrir = async (u) => abiertas.push(u);
  let r = await musica.reproducir("queen", { abrir, buscarVideos: async () => [{ id: "fJ9rUzIMcZQ", titulo: "Bohemian", canal: "Queen" }] });
  igual("abre el video con reproducción automática", abiertas, ["https://www.youtube.com/watch?v=fJ9rUzIMcZQ&autoplay=1"]);
  igual("devuelve el título", r.titulo, "Bohemian");
  abiertas.length = 0;
  r = await musica.reproducir("xyz & otra=1", { abrir, buscarVideos: async () => [] });
  igual("sin resultados abre la búsqueda", abiertas, ["https://www.youtube.com/results?search_query=xyz%20%26%20otra%3D1"]);
  abiertas.length = 0;
  r = await musica.reproducir("queen", { abrir, buscarVideos: async () => { throw new Error("sin red"); } });
  igual("sin internet avisa y no abre nada", [r.error, abiertas.length], [musica.FRASES_MUSICA.sinConexion, 0]);
  igual("sin consulta", !!(await musica.reproducir("  ", { abrir })).error, true);

  // ---------- Control: la misma tecla pausa y reanuda ----------
  musica.reiniciar();
  const teclas = [], tecla = async (n) => teclas.push(n);
  await musica.controlar("pausar", { tecla });
  r = await musica.controlar("pausar", { tecla });
  igual("no reanuda al pausar dos veces", [teclas.length, r.frase], [1, musica.FRASES_MUSICA.yaPausada]);
  await musica.controlar("seguir", { tecla });
  r = await musica.controlar("seguir", { tecla });
  igual("no pausa al seguir dos veces", [teclas.length, r.frase], [2, musica.FRASES_MUSICA.yaSuena]);
  await musica.controlar("siguiente", { tecla });
  igual("siguiente", teclas.at(-1), "siguiente");

  // ---------- Con el cerebro, sin modelo ----------
  const usadas = [], fetchReal = global.fetch;
  const tools = {
    schema: require("../src/tools").makeTools({ openExternal: async () => {}, openPath: async () => "" }).schema,
    run: async (n, a) => { usadas.push([n, a]); return n === "reproducir_youtube" ? { ok: true, titulo: "Queen - Bohemian Rhapsody (Official Video)" } : { ok: true, frase: "Listo, en pausa." }; },
  };
  global.fetch = async () => { throw new Error("no debe llamar al modelo"); };
  let avisos = 0;
  musica.reiniciar();
  igual("responde sin modelo", await brain.ask([], "Pon Bohemian Rhapsody en YouTube", tools, { onMusica: () => avisos++ }), "Pongo Queen - Bohemian Rhapsody.");
  igual("usa la herramienta", usadas[0], ["reproducir_youtube", { consulta: "bohemian rhapsody" }]);
  igual("avisa para no abrir la conversación", avisos, 1);
  igual("pausa", await brain.ask([], "Pausa la música", tools, {}), "Listo, en pausa.");
  igual("sin decir cuál", await brain.ask([], "Pon música", tools, {}), musica.FRASES_MUSICA.queCancion);
  musica.reiniciar();

  // ---------- YouTube de verdad ----------
  if (process.argv.includes("--real")) {
    global.fetch = fetchReal;
    const v = await musica.buscar("bohemian rhapsody queen");
    console.log("  YouTube:", v.slice(0, 3).map((x) => `${x.id} ${x.titulo}`).join(" | "));
    igual("YouTube devuelve videos", v.length > 0, true);
  }

  console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
  process.exit(mal ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
