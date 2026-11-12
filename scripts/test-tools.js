// Prueba el cerebro + herramientas sin Electron: node scripts/test-tools.js "pregunta"
const { makeTools } = require("../src/tools");
const { ask } = require("../src/brain");
const fs = require("fs");
const path = require("path");
const docs = require("../src/documentos");

// Usa el índice que mantiene la app, si ya existe
const DOCS_DB = path.join(process.env.APPDATA || "", "gatito-brujo", "documentos.db");

const tools = makeTools({
  openExternal: async (u) => console.log("   (simulado) abrir URL:", u),
  openPath: async (p) => { console.log("   (simulado) abrir ruta:", p); return ""; },
  docsDb: fs.existsSync(DOCS_DB) ? docs.abrirBD(DOCS_DB) : null,
});

(async () => {
  const qs = process.argv.slice(2);
  const questions = qs.length ? qs : ["¿Qué tiempo hace hoy en Madrid?", "Hola, ¿quién eres?"];
  const history = [];
  for (const q of questions) {
    console.log("\n👤", q);
    const t0 = Date.now();
    let streamed = "";
    const answer = await ask(history, q, tools, {
      onStatus: (s) => console.log("  ", s),
      onToken: (t) => { streamed += t; },
      onCitas: (citas) => citas.forEach((c) => console.log(`   📜 ${c.nombre} · ${c.loc}\n      «${c.texto}»\n      ${c.ruta}`)),
    });
    console.log(`🐈‍⬛ [${((Date.now() - t0) / 1000).toFixed(0)}s] ${answer}`);
    if (!streamed) console.log("   (aviso: no hubo streaming de texto)");
  }
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
