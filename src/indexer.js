// Proceso aparte y de baja prioridad que mantiene al día el índice de documentos.
// Uso: node src/indexer.js <ruta.db> [--una-vez]   (la app lo lanza con utilityProcess)
const fs = require("fs");
const path = require("path");
const os = require("os");
const docs = require("./documentos");

const CADA = 30 * 60 * 1000;
const dbPath = process.argv[2];
const unaVez = process.argv.includes("--una-vez");
const aviso = (m) => { process.parentPort?.postMessage(m); if (process.send) process.send(m); if (unaVez) console.log(JSON.stringify(m)); };

try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {} // el modelo de chat tiene preferencia en la CPU

const db = docs.abrirBD(dbPath);
const q = {
  todos: db.prepare("SELECT id, ruta, tam, mtime, estado FROM docs"),
  insertar: db.prepare("INSERT INTO docs (ruta, nombre, nombre_norm, ext, tipo, tam, mtime, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
  actualizar: db.prepare("UPDATE docs SET tam = ?, mtime = ?, estado = ?, detalle = NULL WHERE id = ?"),
  borrarDoc: db.prepare("DELETE FROM docs WHERE id = ?"),
  borrarFragmento: db.prepare("DELETE FROM fts WHERE rowid = ?"),
  ponerFts: db.prepare("INSERT INTO fts (rowid, nombre, ruta, loc, texto, doc_id) VALUES (?, ?, ?, ?, ?, ?)"),
  pendientes: db.prepare("SELECT id, ruta, nombre FROM docs WHERE estado = 'pendiente' ORDER BY (ext IN ('.md','.txt','.docx','.xlsx')) DESC, tam"),
  estado: db.prepare("UPDATE docs SET estado = ?, detalle = ? WHERE id = ?"),
  meta: db.prepare("INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"),
};
// Fila a fila por id exacto: en FTS5 un rango de rowid recorre toda la tabla y, con miles de borrados, tarda minutos
const limpiarFts = (id) => {
  for (let i = 0; i < docs.MAX_FRAGMENTOS && q.borrarFragmento.run(id * 100000 + i).changes; i++);
};

function transaccion(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}

// Recorre el disco y guarda el catálogo de nombres. Así la búsqueda por nombre funciona enseguida.
function catalogar() {
  const previos = new Map(q.todos.all().map((d) => [d.ruta, d]));
  const vistos = new Set();
  let lote = [];
  const volcar = () => {
    transaccion(() => {
      for (const { ruta, nombre, ext, tipo, tam, mtime } of lote) {
        vistos.add(ruta);
        const previo = previos.get(ruta);
        const estadoNuevo = tipo === "carpeta" ? "carpeta" : docs.EXT_INDEXABLES.has(ext) ? "pendiente" : "solo-nombre";
        if (!previo) q.insertar.run(ruta, nombre, docs.sinAcentos(nombre), ext, tipo, tam, mtime, estadoNuevo);
        else if (previo.tam !== tam || previo.mtime !== mtime) {
          if (estadoNuevo === "pendiente") limpiarFts(previo.id);
          q.actualizar.run(tam, mtime, estadoNuevo, previo.id);
        }
      }
    });
    lote = [];
  };
  const visitados = new Set();
  const recorrer = (dir) => {
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (visitados.has(real.toLowerCase())) return;
    visitados.add(real.toLowerCase());
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const ruta = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // evita bucles y salir de las carpetas permitidas
      if (e.isDirectory()) {
        if (docs.dirExcluido(e.name)) continue;
        lote.push({ ruta, nombre: e.name, ext: "", tipo: "carpeta", tam: 0, mtime: 0 });
        recorrer(ruta);
      } else if (e.isFile() && !docs.esSensible(e.name) && !e.name.startsWith("~$")) {
        let st;
        try { st = fs.statSync(ruta); } catch { continue; }
        lote.push({ ruta, nombre: e.name, ext: path.extname(e.name).toLowerCase(), tipo: "archivo", tam: st.size, mtime: Math.floor(st.mtimeMs) });
      }
      if (lote.length >= 500) volcar();
    }
  };
  for (const r of docs.raices()) recorrer(r);
  volcar();
  // Lo que ya no existe sale del índice
  const borrados = [...previos.values()].filter((d) => !vistos.has(d.ruta));
  transaccion(() => { for (const d of borrados) { limpiarFts(d.id); q.borrarDoc.run(d.id); } });
  return { archivos: vistos.size, borrados: borrados.length };
}

const pausa = () => new Promise((r) => setImmediate(r));

async function indexarPendientes() {
  const lista = q.pendientes.all();
  let hechos = 0;
  for (const d of lista) {
    try {
      const fragmentos = docs.trocear(await docs.extraer(d.ruta));
      transaccion(() => {
        limpiarFts(d.id);
        fragmentos.forEach((f, i) => q.ponerFts.run(d.id * 100000 + i, d.nombre, d.ruta, f.loc, f.texto, d.id));
        q.estado.run(fragmentos.length ? "ok" : "sin-texto", null, d.id);
      });
    } catch (e) {
      q.estado.run("error", String(e.message).slice(0, 200), d.id);
    }
    if (++hechos % 25 === 0 || hechos === lista.length) aviso({ tipo: "progreso", hechos, total: lista.length });
    await pausa();
  }
}

async function pasada() {
  const t0 = Date.now();
  aviso({ tipo: "inicio" });
  if (db.prepare("SELECT valor FROM meta WHERE clave = 'version_lector'").get()?.valor !== docs.VERSION_LECTOR) {
    db.prepare("UPDATE docs SET estado = 'pendiente', detalle = NULL WHERE estado IN ('sin-texto', 'error') OR id IN (SELECT doc_id FROM fts WHERE loc LIKE '%OCR%')").run();
    q.meta.run("version_lector", docs.VERSION_LECTOR);
  }
  const cat = catalogar();
  aviso({ tipo: "catalogo", ...cat, pendientes: docs.estadoIndice(db).pendientes, ms: Date.now() - t0 });
  await indexarPendientes();
  q.meta.run("ultima_pasada", new Date().toISOString());
  db.exec("INSERT INTO fts(fts, rank) VALUES('automerge', 8)");
  aviso({ tipo: "fin", ms: Date.now() - t0, ...docs.estadoIndice(db) });
}

let enCurso = false;
async function ciclo() {
  if (enCurso) return;
  enCurso = true;
  try { await pasada(); } catch (e) { aviso({ tipo: "error", mensaje: e.message }); }
  enCurso = false;
  if (unaVez) { db.close(); process.exit(0); }
}
const recibir = (m) => { if ((m?.data ?? m) === "reindexar") ciclo(); };
process.parentPort?.on("message", recibir);
process.on("message", recibir);

ciclo();
if (!unaVez) setInterval(ciclo, CADA);
