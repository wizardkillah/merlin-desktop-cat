// Conexión con la API de Claude: un turno con streaming y utilidades para las herramientas.
// El bucle de conversación y las reglas de seguridad están en brain.js.
const SDK = require("@anthropic-ai/sdk");
const Anthropic = SDK.default || SDK;

// Dólares por millón de tokens (precios publicados de la API a nov. 2026). Escribir en caché cuesta 1,25 veces la entrada.
// El de lectura de caché de Haiku es una estimación (el 10 % de la entrada).
const MODELOS = {
  "claude-opus-5-5": { nombre: "Opus 5.5 (el más capaz)", entrada: 4, salida: 20, cache: 0.2 },
  "claude-sonnet-5-5": { nombre: "Sonnet 5.5 (equilibrado)", entrada: 2, salida: 10, cache: 0.2 },
  "claude-haiku-5-5": { nombre: "Haiku 5.5 (el más barato)", entrada: 0.1, salida: 0.5, cache: 0.01 },
};
let modelo = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const usarModelo = (m) => { if (MODELOS[m]) modelo = m; };
// Conversación por voz: importa más empezar pronto que pensar mucho
const ESFUERZO = process.env.CLAUDE_EFFORT || "low";
const MAX_TOKENS = 4096;
// Si el clasificador de seguridad rechaza una petición, la API la repite en otro modelo. Haiku no lo admite.
const conRespaldo = () => /opus-5|fable|sonnet-5-5/.test(modelo);
const REINTENTOS_JSON = 2;

// Lo que costó un turno, a partir de lo que informa la API. El pensamiento se cobra como salida aunque no se vea.
function costo(usage = {}, de = modelo) {
  const p = MODELOS[de] || MODELOS[Object.keys(MODELOS).find((k) => de?.startsWith(k))] || MODELOS[modelo];
  const entrada = usage.input_tokens || 0, escrita = usage.cache_creation_input_tokens || 0, leida = usage.cache_read_input_tokens || 0, salida = usage.output_tokens || 0;
  return { entrada, escrita, leida, salida, usd: (entrada * p.entrada + escrita * p.entrada * 1.25 + leida * p.cache + salida * p.salida) / 1e6 };
}

let clave = "", cliente = null;
function configurar(nueva) { clave = nueva || ""; cliente = null; }
const credencial = () => clave || process.env.ANTHROPIC_API_KEY || "";
const disponible = () => !!(credencial() || process.env.ANTHROPIC_AUTH_TOKEN);
function obtener() {
  return (cliente ??= new Anthropic({ apiKey: credencial() || undefined, timeout: 30000, maxRetries: 1 }));
}

// tools.schema está en formato de funciones; aquí pasa al formato de la API
function herramientas(schema) {
  return schema.map(({ function: f }) => ({ name: f.name, description: f.description, input_schema: f.parameters, eager_input_streaming: true }));
}

// Con eager_input_streaming la API no valida la entrada: se comprueba aquí antes de ejecutar nada.
// Devuelve solo los campos declarados, o null si la entrada no sirve.
function validarEntrada(schema, nombre, entrada) {
  const def = schema.find((t) => t.function.name === nombre)?.function.parameters;
  if (!def || !entrada || typeof entrada !== "object") return null;
  const limpia = {};
  for (const [k, p] of Object.entries(def.properties || {})) {
    if (entrada[k] === undefined) continue;
    if (typeof entrada[k] !== p.type) return null;
    limpia[k] = entrada[k];
  }
  return (def.required || []).every((k) => typeof limpia[k] === "string" ? limpia[k].trim() : limpia[k] !== undefined) ? limpia : null;
}

function errorDeAborto() { const e = new Error("cancelado"); e.name = "AbortError"; return e; }

// Un turno del modelo. onTexto recibe el texto a medida que llega; devuelve el mensaje completo.
// onUso recibe { usage, model } de cada intento, también si se cancela o falla a medias: esos tokens se cobran igual.
// onReinicio avisa de que se repite el turno después de haber mostrado texto, para que no salga dos veces.
async function turno({ system, messages, tools, tool_choice, onTexto, signal, onUso, onReinicio }) {
  for (let intento = 0; ; intento++) {
    let parcial = null, conTexto = false;
    const informar = (m) => { if (m?.usage) onUso?.(m); parcial = null; };
    try {
      const stream = obtener().beta.messages.stream({
        model: modelo,
        max_tokens: MAX_TOKENS,
        ...(conRespaldo() ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        cache_control: { type: "ephemeral" },
        output_config: { effort: ESFUERZO },
        system,
        messages,
        tools,
        ...(tool_choice ? { tool_choice } : {}),
      }, { signal });
      for await (const ev of stream) {
        if (ev.type === "message_start") parcial = { model: ev.message.model, usage: { ...ev.message.usage } };
        else if (ev.type === "message_delta" && parcial && ev.usage) Object.assign(parcial.usage, Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v != null)));
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { conTexto = true; onTexto?.(ev.delta.text); }
      }
      const final = await stream.finalMessage();
      informar(final);
      return final;
    } catch (e) {
      informar(parcial);
      if (signal?.aborted || e instanceof Anthropic.APIUserAbortError) throw errorDeAborto();
      if (e instanceof Anthropic.APIError || !(e instanceof Anthropic.AnthropicError) || intento >= REINTENTOS_JSON) throw e;
      // JSON de una herramienta imposible de leer: se repite el turno, con un máximo de intentos
      if (conTexto) onReinicio?.();
    }
  }
}

// Clave rechazada: reintentar o pasar a otro cerebro no lo arregla, hay que avisar al usuario
const esErrorDeClave = (e) => e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError;

async function comprobar() {
  if (!disponible()) return { ok: false, motivo: "falta la clave" };
  try { await obtener().models.retrieve(modelo); return { ok: true }; }
  catch (e) { return { ok: false, motivo: esErrorDeClave(e) ? "la clave no es válida" : e.message }; }
}

module.exports = { MODELOS, modelo: () => modelo, usarModelo, costo, configurar, disponible, herramientas, validarEntrada, turno, esErrorDeClave, comprobar };
