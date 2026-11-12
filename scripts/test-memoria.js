// Memoria por temas, sin modelo y en una carpeta temporal (no toca la bóveda real):
//   node --no-warnings scripts/test-memoria.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merlin-memoria-"));
process.env.MERLIN_PERSONALIDAD = path.join(tmp, "Personalidad");
const personalidad = require("../src/personalidad");
const memoria = require("../src/memoria");

let ok = 0, mal = 0;
const cierto = (nombre, v) => { if (v) ok++; else { mal++; console.log(`✘ ${nombre}`); } };
const igual = (nombre, real, esperado) => cierto(`${nombre}\n   real:     ${JSON.stringify(real)}\n   esperado: ${JSON.stringify(esperado)}`, JSON.stringify(real) === JSON.stringify(esperado));
const textos = (lista) => lista.map((r) => r.texto);
const nota = (tema) => fs.readFileSync(path.join(memoria.rutaCarpeta(), tema + ".md"), "utf8");

// --- Carpeta ---
cierto("la memoria vive junto a Personalidad", memoria.rutaCarpeta() === path.join(tmp, "Personalidad", "Memoria"));
memoria.asegurar();
cierto("crea la nota que explica cómo funciona", fs.existsSync(path.join(memoria.rutaCarpeta(), "_Cómo funciona.md")));
igual("esa nota no cuenta como tema", memoria.temas(), []);

// --- Leer notas ---
const leidas = memoria.trocearNota("---\ntags: [x]\n---\n# Trabajo\n\nTrabajo en una viña de Colchagua.\nEntro a las 8.\n\n## Equipo\n- 2026-01-02: mi jefa se llama Ana\n* [x] terminar el informe\n1. reunión los lunes\n");
igual("viñetas, párrafos y secciones", leidas.map((r) => [r.seccion, r.texto]), [["Trabajo", "Trabajo en una viña de Colchagua. Entro a las 8."], ["Equipo", "mi jefa se llama Ana"], ["Equipo", "terminar el informe"], ["Equipo", "reunión los lunes"]]);
igual("descarta lo que parece secreto", textos(memoria.trocearNota("- la clave del wifi es gato123\n- mi tarjeta es 4111 1111 1111 1111\n- me gusta el té")), ["me gusta el té"]);

// --- Guardar por tema ---
let r = memoria.guardar("el trabajo", "mi jefa se llama Ana");
igual("crea la nota del tema", [r.ok, r.tema], [true, "Trabajo"]);
cierto("con fecha y en viñeta", /- \d{4}-\d{2}-\d{2}: mi jefa se llama Ana/.test(nota("Trabajo")));
cierto("con frontmatter de la bóveda", nota("Trabajo").startsWith("---\ntags: [gatito-brujo, memoria]"));
igual("no repite", memoria.guardar("Trabajo", "Mi jefa se llama Ana.").repetido, true);
igual("reusa la nota aunque cambien mayúsculas y acentos", memoria.guardar("TRABAJO", "los viernes salgo a las 3").tema, "Trabajo");
igual("no guarda contraseñas", memoria.guardar("casa", "la contraseña del router es miau").error, "secreto");
igual("tema vacío", memoria.guardar("  ", "algo").error, "vacio");
cierto("un tema no crea rutas raras", memoria.nombreTema("../../Windows") === ".. .. Windows" && !fs.existsSync(path.join(tmp, "Windows.md")));
memoria.guardar("Familia", "mi hermana Carla vive en Valdivia");
memoria.guardar("Familia", "mi sobrino Tomás cumple años en abril");
memoria.guardar("Salud", "soy alérgico a la penicilina");
memoria.guardar("Auto", "el auto es un Suzuki Swift 2019 y le toca revisión técnica en marzo");
fs.writeFileSync(path.join(memoria.rutaCarpeta(), "Gustos.md"), "# Gustos\n\nMe encanta el jazz de los 50, sobre todo Miles Davis.\n\n- comida favorita: pastel de choclo\n");
igual("lista los temas", memoria.temas().sort(), ["Auto", "Familia", "Gustos", "Salud", "Trabajo"]);

// --- Buscar ---
igual("encuentra por palabra", textos(memoria.buscar("¿cómo se llama mi jefa?")), ["mi jefa se llama Ana"]);
igual("encuentra variantes: «hermanas» → «hermana»", textos(memoria.buscar("dónde viven mis hermanas")), ["mi hermana Carla vive en Valdivia"]);
igual("sin acentos: «alergico»", textos(memoria.buscar("soy alergico a algo?")), ["soy alérgico a la penicilina"]);
igual("encuentra párrafos escritos a mano", textos(memoria.buscar("ponme música de jazz")), ["Me encanta el jazz de los 50, sobre todo Miles Davis."]);
igual("el tema también cuenta", textos(memoria.buscar("revisión del auto")), ["el auto es un Suzuki Swift 2019 y le toca revisión técnica en marzo"]);
igual("nada que ver: vacío", memoria.buscar("¿cuál es la capital de Mongolia?"), []);
igual("solo palabras vacías: vacío", memoria.buscar("oye merlín, ¿qué sabes?"), []);
cierto("con tema en el resultado", memoria.buscar("penicilina")[0]?.tema === "Salud");
cierto("formato para el modelo", memoria.formatear(memoria.buscar("penicilina")) === "- [Salud] soy alérgico a la penicilina");
// Una palabra rara basta: el recuerdo es de eso. Una sola palabra común entre varias, no.
igual("una palabra rara basta", textos(memoria.buscar("Valdivia lluvia invierno paraguas")), ["mi hermana Carla vive en Valdivia"]);
igual("una común entre varias no basta", memoria.buscar("dime algo de cumpleaños de famosos y astronautas"), []);
// Límite de tamaño
for (let i = 0; i < 30; i++) memoria.guardar("Viajes", `viaje número ${i} a la playa de Pichilemu con amigos del colegio`);
const muchos = memoria.buscar("viajes a la playa");
cierto("no más de 6 recuerdos", muchos.length <= 6 && muchos.length > 0);
cierto("ni más de 1200 caracteres", muchos.reduce((n, x) => n + x.texto.length, 0) <= 1200);
cierto("prefiere lo más reciente", muchos[0].texto.includes("número 29"));

// --- El grimorio de «recuerda que…»: lo viejo que ya no cabe en las instrucciones se encuentra igual ---
personalidad.guardar("mi perro se llama Pirata");
for (let i = 0; i < 40; i++) personalidad.guardar(`dato de relleno número ${i} para llenar el grimorio`);
cierto("el dato viejo ya no está en las instrucciones", !personalidad.paraPrompt().aprendido.includes("Pirata"));
igual("pero se encuentra", textos(memoria.buscar("¿cómo se llama mi perro?")), ["mi perro se llama Pirata"]);
igual("encuentra por número", textos(memoria.buscar("relleno número 39")), ["dato de relleno número 39 para llenar el grimorio"]);
igual("y lo que ya está en las instrucciones no se repite", memoria.buscar("relleno número 39", { excluir: personalidad.paraPrompt().aprendido }), []);
igual("una palabra común sola no basta entre muchas", memoria.buscar("un dato curioso sobre pulpos"), []);
cierto("del grimorio no se toma su explicación", !memoria.buscar("aquí se guarda lo que le pides").length);

// --- Releer al cambiar ---
fs.writeFileSync(path.join(memoria.rutaCarpeta(), "Salud.md"), "- tomo vitamina D en invierno\n");
igual("ve los cambios hechos a mano", textos(memoria.buscar("vitamina")), ["tomo vitamina D en invierno"]);
igual("y olvida lo que se borró", memoria.buscar("penicilina"), []);
cierto("las notas que empiezan por «_» no se leen", (fs.writeFileSync(path.join(memoria.rutaCarpeta(), "_borrador.md"), "- secreto de borrador xilófono\n"), !memoria.buscar("xilófono").length));

// --- Órdenes por voz ---
igual("«anota en trabajo que…»", personalidad.intencionMemoria("Anota en trabajo que la reunión es los martes"), { tipo: "guardarTema", tema: "trabajo", dato: "la reunión es los martes" });
igual("«recuerda sobre el auto que…»", personalidad.intencionMemoria("Merlín, recuerda sobre el auto que cambié las ruedas."), { tipo: "guardarTema", tema: "el auto", dato: "cambié las ruedas" });
igual("«guarda en tu memoria de salud que…»", personalidad.intencionMemoria("guarda en tu memoria de salud que me operé de la rodilla"), { tipo: "guardarTema", tema: "salud", dato: "me operé de la rodilla" });
igual("«apunta en Proyectos: …»", personalidad.intencionMemoria("apunta en Proyectos: terminar a Merlín"), { tipo: "guardarTema", tema: "Proyectos", dato: "terminar a Merlín" });
igual("«recuerda que…» sigue yendo al grimorio", personalidad.intencionMemoria("recuerda que me gusta el café")?.tipo, "guardar");
cierto("responde dónde lo anotó", personalidad.responderMemoria({ tipo: "guardarTema", tema: "trabajo", dato: "la reunión es los martes" }) === "Anotado en tu nota de Trabajo.");
cierto("y queda en la nota", nota("Trabajo").includes("la reunión es los martes"));
cierto("no anota secretos por tema", personalidad.responderMemoria({ tipo: "guardarTema", tema: "banco", dato: "mi pin es 1234" }) === personalidad.FRASES_MEMORIA.secreto);
cierto("«qué recuerdas de mí» nombra los temas", personalidad.responderMemoria({ tipo: "listar" }).includes("Trabajo"));
const borrado = personalidad.responderMemoria({ tipo: "olvidar", dato: "reunión martes" });
cierto("«olvida lo de…» borra también en las notas de temas", borrado.includes("la reunión es los martes") && !nota("Trabajo").includes("martes"));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(mal ? `\n${ok} bien, ${mal} mal` : `✔ ${ok}/${ok}`);
process.exit(mal ? 1 : 0);
