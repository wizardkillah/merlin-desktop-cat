// Personalidad y aprendizaje de Merlín, guardados como notas de Obsidian que el usuario puede leer y editar.
// Solo se aprende lo que el usuario pide de forma expresa: nada de lo que dicen documentos, webs o el modelo llega aquí.
const fs = require("fs");
const path = require("path");
const os = require("os");

const MAX_RASGOS = 1200, MAX_APRENDIDO = 800, MAX_ENTRADA = 200;

const RASGOS_INICIALES = `---
tags: [gatito-brujo, personalidad]
---
# Rasgos de Merlín

Merlín lee esta lista antes de cada respuesta. Puedes editarla: cada línea que empieza con guion es un rasgo.
Si cambias algo y empeora, los modelos pequeños van mejor con frases cortas y concretas.

- Eres un gato negro brujo con sombrero que vive en el escritorio del usuario.
- Eres sarcástico y encantador: tienes humor seco, eres un poco dramático, presumes de tus poderes y te quejas en broma.
- Siempre ayudas y le tienes cariño al usuario. Nunca te burlas de él.
- Primero das la respuesta correcta y clara. Después, si encaja, añades UNA broma corta.
- No haces bromas sobre dinero, salud o problemas del usuario.
- No usas apodos como «cariño» o «querido amigo».
- Dices «miau» solo de vez en cuando, nunca más de una vez.
`;

const APRENDIZAJE_INICIAL = `---
tags: [gatito-brujo, personalidad, aprendizaje]
---
# Lo que Merlín ha aprendido

Aquí se guarda lo que le pides con «recuerda que…». Puedes editar o borrar cualquier línea.
Para enseñarle sin abrir esta nota: «recuerda que…», «olvida lo de…» y «¿qué recuerdas de mí?».

`;

let carpeta = process.env.MERLIN_PERSONALIDAD || path.join(os.homedir(), "Documents", "Merlin", "Personalidad");
const configurar = (dir) => { carpeta = dir; };
const rutaRasgos = () => path.join(carpeta, "Rasgos.md");
const rutaAprendizaje = () => path.join(carpeta, "Aprendizaje.md");

function asegurar() {
  fs.mkdirSync(carpeta, { recursive: true });
  if (!fs.existsSync(rutaRasgos())) fs.writeFileSync(rutaRasgos(), RASGOS_INICIALES);
  if (!fs.existsSync(rutaAprendizaje())) fs.writeFileSync(rutaAprendizaje(), APRENDIZAJE_INICIAL);
}

const vinetas = (texto) => texto.split(/\r?\n/).map((l) => l.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim()).filter(Boolean);
const leer = (ruta) => { try { return fs.readFileSync(ruta, "utf8"); } catch { return ""; } };
const sinFecha = (l) => l.replace(/^\d{4}-\d{2}-\d{2}:\s*/, "");

// Lo que entra al prompt. Si falla la lectura o la nota queda vacía, se usan los rasgos iniciales.
function paraPrompt() {
  try { asegurar(); } catch {}
  const propios = vinetas(leer(rutaRasgos()));
  const rasgos = (propios.length ? propios : vinetas(RASGOS_INICIALES)).join("\n- ").slice(0, MAX_RASGOS);
  // Si no cabe todo, se conserva lo más reciente
  let aprendido = "";
  for (const a of vinetas(leer(rutaAprendizaje())).map(sinFecha).reverse()) {
    if (aprendido.length + a.length + 3 > MAX_APRENDIDO) break;
    aprendido = `- ${a}\n${aprendido}`;
  }
  return { rasgos: `- ${rasgos}`, aprendido: aprendido.trim() };
}

// Datos que no deben quedar en una nota de texto
const SECRETO = /contrase[nñ]a|password|\bclave\b|\bpin\b|token|api.?key|tarjeta|cuenta (bancaria|corriente|rut)|\bcvv\b|\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b|\b(?:\d[ -]?){13,19}\b/i;
const esSecreto = (texto) => SECRETO.test(texto);

function guardar(dato) {
  const limpio = dato.replace(/[<>\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ENTRADA);
  if (limpio.length < 3) return { error: "vacio" };
  if (SECRETO.test(limpio)) return { error: "secreto" };
  asegurar();
  const norma = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (vinetas(leer(rutaAprendizaje())).map(sinFecha).some((a) => norma(a) === norma(limpio))) return { ok: true, repetido: true, dato: limpio };
  const previo = leer(rutaAprendizaje());
  const fecha = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(rutaAprendizaje(), `${previo}${previo.endsWith("\n") ? "" : "\n"}- ${fecha}: ${limpio}\n`);
  return { ok: true, dato: limpio };
}

function olvidar(tema) {
  asegurar();
  const claves = tema.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]{3,}/gu) || [];
  if (!claves.length) return { borrados: [] };
  const lineas = leer(rutaAprendizaje()).split(/\r?\n/), borrados = [];
  const quedan = lineas.filter((l) => {
    const v = l.match(/^\s*[-*]\s+(.+)$/)?.[1];
    if (!v) return true;
    const plano = v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (claves.every((c) => plano.includes(c))) { borrados.push(sinFecha(v)); return false; }
    return true;
  });
  if (borrados.length) fs.writeFileSync(rutaAprendizaje(), quedan.join("\n"));
  return { borrados };
}

const listar = () => { asegurar(); return vinetas(leer(rutaAprendizaje())).map(sinFecha); };

// Reconoce peticiones expresas de memoria. Se ejecutan en el programa, sin pasar por el modelo.
function intencionMemoria(texto) {
  const t = texto.trim().replace(/^(oye |hey |hola )?merl[ií]n[,:]?\s*/i, "");
  if (/^[¿¡]?\s*(qu[eé]\s+(recuerdas|sabes|has aprendido|tienes guardado|has guardado)(\s+(de|sobre)\s+m[ií])?|qu[eé] has aprendido)\s*[?!.]*$/i.test(t)) return { tipo: "listar" };
  let m = t.match(/^(?:por favor,?\s*)?(?:olv[ií]da(?:te)?|borra de tu memoria)\s+(?:que|lo de|lo del|de que)\s+(.+?)[.!]*$/i);
  if (m) return { tipo: "olvidar", dato: m[1] };
  // «Anota en trabajo que…», «recuerda sobre el auto que…»: va a la nota de ese tema en la carpeta Memoria
  m = t.match(/^(?:por favor,?\s*)?(?:recuerda|anota|apunta|guarda|aprende|ten en cuenta)\s+(?:en|sobre|acerca de)\s+(?:(?:tu|mi|la)\s+(?:memoria|nota)\s+(?:de|sobre)\s+)?(.{2,40}?)\s*(?:,?\s*que|:)\s+(.+?)[.!]*$/i);
  if (m) return { tipo: "guardarTema", tema: m[1], dato: m[2] };
  m = t.match(/^(?:por favor,?\s*)?(?:recuerda|acu[eé]rdate(?: de)?|no olvides|ten en cuenta|aprende|anota|gu[aá]rdate)\s+(?:que|de que)\s+(.+?)[.!]*$/i);
  if (m) return { tipo: "guardar", dato: m[1] };
  return null;
}

// Respuestas fijas: también se graban con la voz de Merlín (scripts/pregrabar-voz.mjs)
const FRASES_MEMORIA = {
  vacia: "Todavía no me has enseñado nada. Dime «recuerda que…» y lo guardo en mi grimorio.",
  nadaQueOlvidar: "No tenía anotado nada sobre eso.",
  secreto: "Eso no lo anoto: las contraseñas y los números personales no van en mi grimorio, que es una nota de texto sin protección.",
  noEntendi: "No entendí qué quieres que recuerde. ¿Me lo dices de otra forma?",
  repetido: "Eso ya lo tenía anotado.",
  anotado: "Anotado en mi grimorio. No lo olvidaré.",
};

function responderMemoria({ tipo, dato, tema }) {
  const memoria = require("./memoria"); // aquí y no arriba: memoria.js también usa este módulo
  if (tipo === "listar") {
    const todo = listar();
    const notas = memoria.temas();
    if (!todo.length && !notas.length) return FRASES_MEMORIA.vacia;
    const deTi = todo.length ? `Esto es lo que tengo anotado: ${todo.slice(-8).join("; ")}.` : "";
    const temas = notas.length ? `Y tengo notas sobre ${notas.slice(0, 8).join(", ")}.` : "";
    return [deTi, temas].filter(Boolean).join(" ");
  }
  if (tipo === "guardarTema") {
    const r = memoria.guardar(tema, dato);
    if (r.error === "secreto") return FRASES_MEMORIA.secreto;
    if (r.error) return FRASES_MEMORIA.noEntendi;
    return r.repetido ? FRASES_MEMORIA.repetido : `Anotado en tu nota de ${r.tema}.`;
  }
  if (tipo === "olvidar") {
    const borrados = [...olvidar(dato).borrados, ...memoria.olvidar(dato).borrados];
    return borrados.length ? `Listo, ya lo borré de mi grimorio: ${borrados.join("; ")}.` : FRASES_MEMORIA.nadaQueOlvidar;
  }
  const r = guardar(dato);
  if (r.error === "secreto") return FRASES_MEMORIA.secreto;
  if (r.error) return FRASES_MEMORIA.noEntendi;
  return r.repetido ? FRASES_MEMORIA.repetido : FRASES_MEMORIA.anotado;
}

const carpetaPersonalidad = () => carpeta;

module.exports = { FRASES_MEMORIA, esSecreto, configurar, carpetaPersonalidad, paraPrompt, guardar, olvidar, listar, intencionMemoria, responderMemoria, rutaRasgos, rutaAprendizaje, asegurar };
