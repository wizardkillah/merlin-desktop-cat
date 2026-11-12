// Avatar de Merlín: reproduce los vídeos de "Imagenes Merlin" y quita el fondo verde en tiempo real con WebGL.
// Los archivos de la carpeta no se modifican. Qué archivo corresponde a cada estado se define en avatar.json.
const FUNDIDO_ESTADO = 280, FUNDIDO_BUCLE = 450; // ms
const INTERVALO = 1000 / 20;

const VS = `attribute vec2 p; varying vec2 uv; void main() { uv = vec2((p.x + 1.) / 2., (1. - p.y) / 2.); gl_Position = vec4(p, 0., 1.); }`;
const FS = `precision mediump float;
varying vec2 uv;
uniform sampler2D texA, texB;
uniform vec4 recA, recB;   // origen y tamaño del recorte, en coordenadas de la textura
uniform vec3 keyA, keyB;   // verde del fondo, fundido abajo, fundido arriba
uniform vec4 tapaA, tapaB; // rectángulo opcional a ocultar (x0, y0, x1, y1 en la textura)
uniform float mezcla, espejo;
vec4 muestra(sampler2D tex, vec4 rec, vec3 key, vec4 tapa) {
  vec2 q = vec2(espejo > .5 ? 1. - uv.x : uv.x, uv.y);
  vec2 t = rec.xy + q * rec.zw;
  if (t.x < 0. || t.x > 1. || t.y < 0. || t.y > 1.) return vec4(0.);
  if (t.x > tapa.x && t.y > tapa.y && t.x < tapa.z && t.y < tapa.w) return vec4(0.);
  vec3 c = texture2D(tex, t).rgb;
  float verde = c.g - max(c.r, c.b);
  float a = 1. - smoothstep(key.x * .30, key.x * .72, verde);
  c.g = min(c.g, (c.r + c.b) * .5 + .03);            // quita el reflejo verde de bordes y halos sin dejarlos azulados
  if (key.y > 0.) a *= smoothstep(0., key.y, 1. - t.y);
  if (key.z > 0.) a *= smoothstep(0., key.z, t.y);
  return vec4(c * a, a);
}
void main() {
  vec4 a = muestra(texA, recA, keyA, tapaA);
  gl_FragColor = mezcla > 0. ? mix(a, muestra(texB, recB, keyB, tapaB), mezcla) : a;
}`;

function programa(gl) {
  const sh = (tipo, src) => {
    const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const url = (carpeta, archivo) => `/${encodeURIComponent(carpeta)}/${encodeURIComponent(archivo)}`;

// Una fuente es un vídeo (bucle) o, si el vídeo no está, la imagen fija del estado.
async function cargarFuente(carpeta, cfg) {
  const r = cfg.video && await fetch(url(carpeta, cfg.video)).catch(() => null);
  if (r?.ok) {
    const blobUrl = URL.createObjectURL(await r.blob()); // en memoria: buscar en el vídeo no depende del protocolo app://
    const nuevo = async () => {
      const v = Object.assign(document.createElement("video"), { src: blobUrl, muted: true, playsInline: true, preload: "auto" });
      await new Promise((ok, mal) => { v.onloadeddata = ok; v.onerror = () => mal(new Error("no se pudo leer " + cfg.video)); });
      return v;
    };
    return { cfg, tipo: "video", el: [await nuevo(), await nuevo()], ancho: 1280, alto: 720 };
  }
  const img = new Image();
  img.src = url(carpeta, cfg.imagen);
  await img.decode();
  // Las imágenes son cuadradas y el gato ya está encuadrado: recorte completo
  return { cfg: { verde: 120, ...cfg, cx: img.naturalWidth / 2, cy: img.naturalHeight / 2, lado: img.naturalWidth }, tipo: "imagen", el: [img, img] };
}

export async function crearAvatar(canvas) {
  const manifiesto = await (await fetch("avatar.json")).json();
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("WebGL no disponible");
  const fuentes = {};
  const entradas = Object.entries(manifiesto.estados);
  await Promise.all(entradas.map(async ([nombre, cfg]) => { fuentes[nombre] = await cargarFuente(manifiesto.carpeta, cfg); }));
  if (!fuentes.idle) throw new Error("Falta el estado idle");

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  gl.viewport(0, 0, canvas.width, canvas.height);
  const prog = programa(gl); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  const texturas = [0, 1].map((i) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  });
  gl.uniform1i(u("texA"), 0); gl.uniform1i(u("texB"), 1);

  const usar = (slot, f) => {
    const w = f.ancho || f.el[0].naturalWidth, h = f.alto || f.el[0].naturalHeight, c = f.cfg;
    gl.uniform4f(u(slot === 0 ? "recA" : "recB"), (c.cx - c.lado / 2) / w, (c.cy - c.lado / 2) / h, c.lado / w, c.lado / h);
    gl.uniform3f(u(slot === 0 ? "keyA" : "keyB"), c.verde / 255, c.fundidoAbajo || 0, c.fundidoArriba || 0);
    const [x0, y0, x1, y1] = c.ocultar || [0, 0, 0, 0];
    gl.uniform4f(u(slot === 0 ? "tapaA" : "tapaB"), x0 / w, y0 / h, x1 / w, y1 / h);
  };
  const subir = (slot, el) => {
    gl.activeTexture(gl.TEXTURE0 + slot); gl.bindTexture(gl.TEXTURE_2D, texturas[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
  };
  const inicioBucle = (f) => f.cfg.bucle?.[0] || 0;
  const finBucle = (f) => Math.min(f.cfg.bucle?.[1] || Infinity, f.el[0].duration || Infinity);

  // "actual" se ve siempre; "siguiente" entra con un fundido (cambio de estado o vuelta del bucle)
  let actual = { f: fuentes.idle, el: fuentes.idle.el[0], i: 0 };
  let siguiente = null, inicioFundido = 0, duracionFundido = 0, espejo = false, cambio = true, parado = false;

  const arrancar = (f, i) => {
    const el = f.el[i];
    if (f.tipo === "video") { el.currentTime = inicioBucle(f); el.play().catch(() => {}); }
    return { f, el, i };
  };
  const pararVideo = (x) => { if (x.f.tipo === "video") x.el.pause(); };
  const fundirA = (f, i, ms) => {
    if (siguiente) { pararVideo(actual); actual = siguiente; }
    siguiente = arrancar(f, i); inicioFundido = performance.now(); duracionFundido = ms;
  };

  let ultimoT = -1, ultimoTB = -1, ultimoDibujo = 0;
  function cuadro() {
    requestAnimationFrame(cuadro);
    if (parado) return;
    const ahora = performance.now();
    if (!siguiente && actual.f.tipo === "video" && actual.el.currentTime >= finBucle(actual.f) - FUNDIDO_BUCLE / 1000)
      fundirA(actual.f, 1 - actual.i, FUNDIDO_BUCLE);

    const mezcla = siguiente ? Math.min(1, (ahora - inicioFundido) / duracionFundido) : 0;
    const tA = actual.f.tipo === "video" ? actual.el.currentTime : 0, tB = siguiente?.f.tipo === "video" ? siguiente.el.currentTime : 0;
    if (tA === ultimoT && tB === ultimoTB && !siguiente && !cambio) return; // sin fotograma nuevo: no gasta CPU
    if (ahora - ultimoDibujo < INTERVALO && !cambio) return;                // el modelo usa la misma CPU: 20 cuadros por segundo bastan
    ultimoDibujo = ahora;
    ultimoT = tA; ultimoTB = tB; cambio = false;

    usar(0, actual.f); subir(0, actual.el);
    if (siguiente) { usar(1, siguiente.f); subir(1, siguiente.el); }
    gl.uniform1f(u("mezcla"), mezcla); gl.uniform1f(u("espejo"), espejo ? 1 : 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (siguiente && mezcla >= 1) { pararVideo(actual); actual = siguiente; siguiente = null; cambio = true; }
  }
  actual = arrancar(fuentes.idle, 0);
  requestAnimationFrame(cuadro);

  return {
    manifiesto,
    urlDe: (archivo) => url(manifiesto.carpeta, archivo),
    // Se ejecuta aunque el estado no cambie: paseo a izquierda o derecha usa el mismo vídeo
    estado(nombre, mirandoIzquierda = false) {
      espejo = mirandoIzquierda; cambio = true;
      const f = fuentes[nombre] || fuentes.idle;
      if ((siguiente || actual).f === f) return;
      fundirA(f, 0, FUNDIDO_ESTADO);
    },
    // Opacidad del gato en un punto del lienzo: deja pasar los clics por las zonas transparentes
    opacidadEn(x, y) {
      const r = canvas.getBoundingClientRect(), k = canvas.width / r.width, px = new Uint8Array(4);
      gl.readPixels(Math.round((x - r.left) * k), canvas.height - Math.round((y - r.top) * k), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px[3] / 255;
    },
    pausar(v) { parado = v; const el = (siguiente || actual); if (el.f.tipo === "video") v ? el.el.pause() : el.el.play().catch(() => {}); },
    diagnostico: () => ({ estado: Object.keys(fuentes).find((k) => fuentes[k] === (siguiente || actual).f), t: actual.el.currentTime, fuentes: Object.fromEntries(entradas.map(([k]) => [k, fuentes[k].tipo])) }),
  };
}
