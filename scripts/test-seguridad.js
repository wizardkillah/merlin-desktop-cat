// Comprueba las barreras de las herramientas sin abrir nada ni salir a internet:
//   node --no-warnings scripts/test-seguridad.js
// - abrir_archivo solo abre documentos, imágenes, audio, vídeo y carpetas, y dentro de las carpetas permitidas
// - leer_pagina no pide direcciones de este PC ni de la red local
const fs = require("fs");
const path = require("path");
const os = require("os");
const { makeTools, destinoPublico, esIpPrivada } = require("../src/tools");

let ok = 0, mal = 0;
const cierto = (nombre, v) => { if (v) ok++; else { mal++; console.log(`✘ ${nombre}`); } };

(async () => {
  // realpath: la carpeta temporal puede venir con el nombre corto de Windows (HPELIT~1)
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "merlin-seguridad-")));
  const fuera = fs.mkdtempSync(path.join(os.tmpdir(), "merlin-fuera-"));
  const crear = (dir, n) => { const p = path.join(dir, n); fs.writeFileSync(p, "x"); return p; };
  const abiertos = [];
  const t = makeTools({ openExternal: async () => {}, openPath: async (p) => { abiertos.push(p); return ""; }, listaRaices: [raiz] });
  const abre = async (p) => { abiertos.length = 0; const r = await t.run("abrir_archivo", { path: p }); return !!r.ok && abiertos.length === 1; };

  for (const n of ["contrato.pdf", "foto.JPG", "cancion.mp3", "notas.md", "planilla.xlsx"]) cierto(`abre ${n}`, await abre(crear(raiz, n)));
  cierto("abre una carpeta", await abre(raiz));
  for (const n of ["programa.exe", "consola.msc", "atajo.url", "app.appref-ms", "disco.iso", "ayuda.chm", "macro.xlsm", "script.psm1", "x.settingcontent-ms", "inst.appinstaller", "w.wsc", "py.pyw", "acceso.lnk", "pagina.html", "sin-extension"]) {
    cierto(`no abre ${n}`, !(await abre(crear(raiz, n))));
  }
  // Windows quita el punto o el espacio final al abrir: «programa.exe.» abriría el .exe
  fs.writeFileSync(path.join(raiz, "trampa.exe"), "x");
  cierto("no abre «trampa.exe.»", !(await abre(path.join(raiz, "trampa.exe."))));
  cierto("no abre «trampa.exe »", !(await abre(path.join(raiz, "trampa.exe "))));
  cierto("no abre «doc.pdf.exe»", !(await abre(crear(raiz, "doc.pdf.exe"))));
  cierto("no abre fuera de las carpetas permitidas", !(await abre(crear(fuera, "otro.pdf"))));
  cierto("no abre archivos de claves", !(await abre(crear(raiz, "passwords.txt"))));
  cierto("no abre lo que no existe", !(await abre(path.join(raiz, "no-existe.pdf"))));

  // --- Direcciones privadas ---
  for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.1", "169.254.1.1", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) cierto(`${ip} es privada`, esIpPrivada(ip));
  for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111"]) cierto(`${ip} es pública`, !esIpPrivada(ip));
  const publica = async () => [{ address: "93.184.216.34" }], privada = async () => [{ address: "127.0.0.1" }];
  cierto("localhost no", !(await destinoPublico("http://localhost:1235/v1/models", publica)));
  cierto("127.0.0.1 no", !(await destinoPublico("http://127.0.0.1:3900/", publica)));
  cierto("[::1] no", !(await destinoPublico("http://[::1]:3900/", publica)));
  cierto("router.local no", !(await destinoPublico("http://router.local/", publica)));
  cierto("un dominio que apunta a 127.0.0.1 no", !(await destinoPublico("https://trampa.example/", privada)));
  cierto("un dominio público sí", await destinoPublico("https://es.wikipedia.org/wiki/Gato", publica));
  cierto("file: no", !(await destinoPublico("file:///C:/Windows/win.ini", publica)));

  // --- IPv6 con una IPv4 dentro: el analizador de URLs las escribe en hexadecimal ---
  for (const url of ["http://[::ffff:127.0.0.1]:1235/", "http://[::ffff:192.168.1.1]/", "http://[::ffff:10.0.0.1]/", "http://[::127.0.0.1]/",
    "http://[64:ff9b::7f00:1]/", "http://[::ffff:0:127.0.0.1]/", "http://[2002:7f00:1::]/", "http://[::ffff:169.254.169.254]/"]) {
    cierto(`${url} no (${new URL(url).hostname})`, !(await destinoPublico(url, publica)));
  }
  for (const ip of ["::ffff:7f00:1", "::ffff:c0a8:101", "::ffff:a00:1", "::7f00:1", "64:ff9b::a00:1", "2001:0:4136:e378::1", "fec0::1", "ff02::1", "::"]) cierto(`${ip} es privada`, esIpPrivada(ip));
  for (const ip of ["::ffff:808:808", "::ffff:8.8.8.8", "64:ff9b::808:808", "2001:4860:4860::8888", "2606:4700::1111"]) cierto(`${ip} es pública`, !esIpPrivada(ip));
  cierto("un dominio con AAAA ::ffff:7f00:1 no", !(await destinoPublico("https://trampa6.example/", async () => [{ address: "::ffff:7f00:1" }])));
  cierto("un dominio con AAAA pública sí", await destinoPublico("https://ok6.example/", async () => [{ address: "2606:4700::1111" }]));

  fs.rmSync(raiz, { recursive: true, force: true });
  fs.rmSync(fuera, { recursive: true, force: true });
  console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
  process.exit(mal ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
