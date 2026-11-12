// Prueba del lector de llamadas a herramientas: node scripts/test-parser.js
const { parseToolCall, stripToolTags } = require("../src/brain");
const names = ["buscar_web", "leer_pagina", "buscar_archivos", "abrir_url", "abrir_archivo", "fecha_hora"];
const cases = [
  ['<herramienta>{"nombre": "buscar_web", "args": {"query": "tiempo Madrid"}}</herramienta>', "buscar_web", { query: "tiempo Madrid" }],
  ['<herramienta>{"nombre": "buscar_web", "args": {"query": "tiempo Madrid"}}', "buscar_web", { query: "tiempo Madrid" }],
  ['<buscar_web>{"query": "balon de oro"}</buscar_web>', "buscar_web", { query: "balon de oro" }],
  ['<buscar_archivos{"name": "README"}>\n¡Miau! He encontrado...', "buscar_archivos", { name: "README" }],
  ["<fecha_hora/>", "fecha_hora", {}],
  ['```json\n{"nombre": "abrir_url", "args": {"url": "https://a.com"}}\n```', "abrir_url", { url: "https://a.com" }],
  ['Vale, voy a mirar. <herramienta>{"nombre":"leer_pagina","args":{"url":"https://x.es/a?b={c}"}}', "leer_pagina", { url: "https://x.es/a?b={c}" }],
  ['<buscar_pagina>{"url": "https://es.wikipedia.org"}</buscar_pagina>', "buscar_pagina", { url: "https://es.wikipedia.org" }],
  ["¡Miau! Soy Merlín, tu gatito brujo.", null, null],
];
let ok = 0;
for (const [input, name, args] of cases) {
  const r = parseToolCall(input, names);
  const pass = name === null ? r === null : r && r.name === name && JSON.stringify(r.args) === JSON.stringify(args);
  console.log(pass ? "✔" : "✘", JSON.stringify(input).slice(0, 70), "→", JSON.stringify(r));
  if (pass) ok++;
}
const s = stripToolTags("¡Hola! Soy Merlín. <fecha_hora/>", names);
console.log(s === "¡Hola! Soy Merlín." ? "✔" : "✘", "stripToolTags →", JSON.stringify(s));
console.log(`${ok}/${cases.length} casos OK`);
process.exit(ok === cases.length ? 0 : 1);
