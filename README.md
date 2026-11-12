# 🐈‍⬛🎩 Merlín, el gatito brujo de escritorio

Asistente de escritorio: un gatito negro con sombrero de brujo que vive en una esquina de la pantalla.
Dile **«Merlín»** y pídele algo, o escríbele; busca en internet, lee webs, encuentra tus documentos y archivos, cita su contenido y los abre.

- Cerebro: API de Claude (`claude-opus-5-5`) con la clave que pongas en clic derecho › Cerebro. Sin clave o sin conexión usa LM Studio (`google/gemma-3-4b`) en `http://localhost:1235/v1`
- Documentos: por defecto **su contenido no sale del PC**, lo lee el modelo local aunque Claude esté activo. Se cambia en clic derecho › Cerebro. A Claude sí llegan la conversación, lo que le pediste recordar y los nombres de archivo que busques
- Oído: micrófono predeterminado de Windows, siempre abierto mientras se vea la 👂, y Whisper (`whisper-base`) en local: `whisper.cpp` nativo v1.9.2 en `assets/whisper` (licencia MIT) y, si falla, WebAssembly. El audio no se escribe en disco, y lo que no va dirigido a Merlín se descarta
- Voz: neuronal Piper `es_MX-claude-high` en local (si falla, la del sistema, Microsoft Sabina)
- Voz de Merlín: todo lo que el programa dice con texto fijo (saludo, avisos de espera, charla de `src/charla.js`, memoria y errores) se oye con audios de `assets/voces/merlin/`, grabados con el perfil `7912a8c5` de Voice Studio. Lo que escribe el modelo lo dice Piper con el perfil «Merlín», ajustado para acercarse a esa voz. Para grabar lo que falte, con Voice Studio abierto: `npm run voz:pregrabar` (lo ya grabado se conserva; si se corta, sigue por donde iba). Voice Studio no hace falta para usar a Merlín, y una frase sin audio la dice Piper
- Aprendizaje: las preguntas de la lista `Personalidad/Respuestas.md` se responden al instante y sin modelo. Lo que se pregunta varias veces y funciona se añade solo; lo que marcas como malo se borra. Las conversaciones se registran en `%APPDATA%\gatito-brujo\aprendizaje.jsonl`, sin documentos ni secretos, y el resumen está en `Personalidad/Por aprender.md`
- Memoria: una nota por tema en la carpeta `Memoria` de la bóveda (`Trabajo.md`, `Familia.md`…). Antes de responder busca los recuerdos que vienen al caso y los añade a la pregunta. **Esta carpeta sí puede llegar a Claude**; el resto de documentos no
- Aspecto: imágenes y vídeos de `Imagenes Merlin/`, asignados en `src/renderer/avatar.json`
- Documentos: índice local en `%APPDATA%\gatito-brujo\documentos.db` (PDF, también escaneados con el OCR de Windows, Word, Excel, PowerPoint, Markdown, texto)

Documentación completa en la bóveda de Obsidian **Gatito Brujo** (`Documents\respaldo pc\Gatito Brujo`).

## Arrancar

Doble clic en **Merlín** en el escritorio. Para volver a crear el acceso directo: `npm run lanzador`.

A mano:

```
lms server start
lms load google/gemma-3-4b --gpu off --context-length 8192
npm start
```

## Archivos fuera de git

El repositorio guarda el código, las imágenes, los audios de `assets/voces/merlin/` y la documentación. No guarda:

- `node_modules/`: se reinstala con `npm install`.
- `assets/whisper/` (151 MB): `whisper-cli.exe` y sus DLL de [whisper.cpp v1.9.2](https://github.com/ggml-org/whisper.cpp/releases), más el modelo `ggml-base.bin` de [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp).
- `assets/voces/es_MX-claude-high.onnx` (60 MB): la voz Piper de [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices), en `es/es_MX/claude/high`. Su `.onnx.json` sí está en git.
- Datos personales: la clave de Claude, los ajustes, los recordatorios, el registro de aprendizaje y el índice de documentos. Viven en `%APPDATA%\gatito-brujo`, fuera de esta carpeta.

Lo que Merlín aprende y su personalidad están en la bóveda de Obsidian, que tiene su propio respaldo.

## Uso

| | |
|---|---|
| «Merlín, ¿qué hora es?» | Le hablas sin tocar nada. Durante 10 s tras responder no hace falta repetir el nombre |
| «Merlín, cállate» | Lo interrumpe, aunque esté hablando |
| «Merlín, pon Bohemian Rhapsody en YouTube» | Busca el video y lo reproduce en el navegador |
| «Pausa la música», «sigue con la música», «otra canción» | Controla lo que suena. Con la música fuerte, usa `Ctrl+Shift+Espacio`: la pausa y te deja hablarle |
| «Busca en Google X», «¿qué dice Gemini sobre X?» | Abre la búsqueda en tu navegador y lee el resumen de Gemini, o el primer resultado |
| «Lee lo que tengo en pantalla», «resume esta página» | Lee la ventana activa y te lo explica. Solo lee: no hace clics ni escribe |
| «Recuérdame en 20 minutos sacar el pan», «avísame mañana a las 9», «temporizador de 5 minutos» | Avisa en voz alta a su hora, aunque cierres la app entre medio |
| «¿Qué recordatorios tengo?», «¿qué tengo hoy?», «cancela el recordatorio de…» | Los lista o los borra |
| «Mi cumpleaños es el 3 de mayo» | Lo anota y ese día te saluda |
| «¿Cuánto he gastado en Claude?» | Gasto del mes. El tope mensual y el modelo se eligen con clic derecho › Cerebro |
| «¿Qué te dije la semana pasada del viaje?», «¿de qué hablamos ayer?» | Busca en las conversaciones de los últimos 90 días, sin las privadas |
| «Anota en trabajo que la reunión es los martes» | Lo guarda en `Memoria/Trabajo.md` y lo recordará cuando venga al caso |
| «Eso está mal» | Olvida esa respuesta y pregunta cuál es la correcta |
| «Cuando te pregunte X, responde Y» | Le enseña una respuesta |
| Clic en el gatito | Abrir o cerrar la caja de texto |
| Arrastrar | Mover el gatito |
| Clic derecho / icono de la bandeja | Menú (voz, paseos, olvidar conversación, salir) |
| `Ctrl+Shift+Espacio` | Hablarle sin decir su nombre; se detiene solo al hacer una pausa |
| `Ctrl+Shift+K` | Escribirle desde cualquier programa |

## Pruebas

```
node --no-warnings scripts/test-documentos.js # extracción, búsqueda, seguridad y citas
node --no-warnings scripts/test-voz.mjs       # frases, pronunciación y perfiles de la voz
node --no-warnings scripts/test-personalidad.js # rasgos y memoria
node --no-warnings scripts/test-oido.mjs # detector de voz, invocación y eco
node --no-warnings scripts/test-recordatorios.js # recordatorios, cumpleaños y gasto de Claude
node --no-warnings scripts/test-pantalla.js # Google, Gemini y lectura de ventanas, sin abrir nada
node --no-warnings scripts/test-musica.js # órdenes de música; con --real consulta YouTube sin abrir nada
node --no-warnings scripts/test-aprendizaje.js # lista de respuestas y ciclo de aprendizaje
node --no-warnings scripts/test-oido-nativo.js # whisper.cpp con el binario real
node --no-warnings scripts/test-claude.js # camino de Claude contra un servidor falso, y qué sale del PC
node --no-warnings scripts/test-seguridad.js # qué archivos se abren y qué direcciones se leen, sin abrir nada
node --no-warnings scripts/test-memoria.js # memoria por temas: anotar, buscar y olvidar, en una carpeta temporal
node --no-warnings scripts/test-conversaciones.js # conversaciones pasadas: fechas en español y búsqueda
node scripts/test-parser.js          # lector de llamadas a herramientas
node scripts/test-tools.js "pregunta" # cerebro + herramientas, sin interfaz
npm run test:whisper                 # Whisper con scripts/prueba.wav
npx electron . --prueba-voz=carpeta  # el programa real: habla por el altavoz y guarda lo que suena
```
