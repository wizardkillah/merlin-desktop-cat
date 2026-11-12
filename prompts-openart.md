# Prompts para OpenArt: Gatito brujo

Los prompts están en inglés porque suelen dar resultados más fieles. Cada bloque se puede copiar tal cual.

## Orden de trabajo

1. Genera la **imagen maestra** (1.1) hasta que te guste.
2. Úsala como referencia de personaje para las imágenes de los estados (sección 2).
3. Anima cada imagen con image-to-video usando los prompts de la sección 4. Solo describen el movimiento, porque el personaje ya viene en la imagen.
4. Si la herramienta permite fijar primer y último fotograma, usa la misma imagen en ambos para que el bucle no salte.

**Por qué fondo verde:** el gato flota sobre el escritorio, así que necesita fondo transparente. Los vídeos generados no suelen traer canal alfa; el verde se elimina después (sección 6). Por eso los ojos son naranjas: unos ojos verdes desaparecerían junto con el fondo.

**Negative prompt para imágenes:**

```text
text, watermark, logo, signature, extra limbs, extra tail, extra ears, deformed paws, photorealistic, scary, horror, blurry, cropped, busy background, green reflections on fur, cast shadow
```

**Negative prompt para vídeos:**

```text
camera movement, zoom, cuts, background change, morphing, hat changing shape, extra limbs, extra tail, flicker, text, watermark, human speech
```

---

## 1. Imágenes base

### 1.1 Imagen maestra (1:1)

```text
A cute black kitten wizard sitting and facing the viewer in a slight three-quarter view, soft fluffy charcoal-black fur, big round glowing amber-orange eyes, small pink nose, thin white whiskers, wearing an oversized tilted purple witch hat with small lilac stars and a crescent moon, orange hat band with a gold buckle, long tail curling into a spiral at the tip. Stylized 3D render, soft matte clay look, soft studio lighting, clean simple silhouette that reads well at small size. Full body, centered, generous margin on all sides, solid flat pure chroma green background #00FF00.
```

### 1.2 Hoja de personaje (16:9)

```text
Character turnaround sheet of a cute black kitten wizard: front view, three-quarter view, side view and back view, same pose and same scale, aligned in a row. Soft fluffy charcoal-black fur, big round glowing amber-orange eyes, small pink nose, thin white whiskers, oversized tilted purple witch hat with small lilac stars and a crescent moon, orange hat band with a gold buckle, long tail curling into a spiral at the tip. Stylized 3D render, soft matte clay look, soft even lighting, solid flat light grey background, no labels.
```

---

## 2. Imágenes de los estados (1:1, con la maestra como referencia)

### Idle: reposo

```text
A cute black kitten wizard sitting calmly, relaxed and friendly, gentle smile, looking at the viewer, tail curled beside its body. Soft fluffy charcoal-black fur, big round glowing amber-orange eyes, small pink nose, thin white whiskers, oversized tilted purple witch hat with lilac stars and a crescent moon, orange hat band with a gold buckle. Stylized 3D render, soft matte clay look, soft studio lighting. Full body, centered, generous margin, solid flat pure chroma green background #00FF00.
```

### Listening: escuchando

```text
A cute black kitten wizard sitting upright and leaning slightly forward, ears raised and alert, eyes wide open and attentive, head slightly tilted as if hearing a faint sound, faint concentric rings of soft lilac light around its head. Soft fluffy charcoal-black fur, big round glowing amber-orange eyes, small pink nose, thin white whiskers, oversized tilted purple witch hat with lilac stars and a crescent moon, orange hat band with a gold buckle. Stylized 3D render, soft matte clay look, soft studio lighting. Full body, centered, generous margin, solid flat pure chroma green background #00FF00.
```

### Thinking: pensando

```text
A cute black kitten wizard sitting and looking upward in thought, one paw raised to its chin, witch hat wobbling slightly to one side, small golden sparkles and tiny stars floating around the hat. Soft fluffy charcoal-black fur, big round glowing amber-orange eyes, small pink nose, thin white whiskers, oversized purple witch hat with lilac stars and a crescent moon, orange hat band with a gold buckle. Stylized 3D render, soft matte clay look, soft studio lighting. Full body, centered, generous margin, solid flat pure chroma green background #00FF00.
```

### Talking: hablando

```text
A cute black kitten wizard sitting and talking cheerfully, small mouth open in a happy meow, one front paw lifted in a friendly gesture, bright expressive eyes looking at the viewer. Soft fluffy charcoal-black fur, big round glowing amber-orange eyes, small pink nose, thin white whiskers, oversized tilted purple witch hat with lilac stars and a crescent moon, orange hat band with a gold buckle. Stylized 3D render, soft matte clay look, soft studio lighting. Full body, centered, generous margin, solid flat pure chroma green background #00FF00.
```

### Sleeping: durmiendo

```text
A cute black kitten wizard curled up asleep in a loaf, eyes gently closed, peaceful smile, tail wrapped around its body, oversized witch hat slipped forward over one ear, soft lilac glow around it. Soft fluffy charcoal-black fur, small pink nose, thin white whiskers, purple witch hat with lilac stars and a crescent moon, orange hat band with a gold buckle. Stylized 3D render, soft matte clay look, soft dim lighting. Full body, centered, generous margin, solid flat pure chroma green background #00FF00.
```

### Walking: caminando

Para ir en el otro sentido basta con voltear el vídeo en horizontal.

```text
Pure side view of a cute black kitten wizard walking to the right, mid-stride with one front paw forward, tail raised with a spiral at the tip, witch hat bouncing slightly. Soft fluffy charcoal-black fur, big round glowing amber-orange eyes, small pink nose, thin white whiskers, oversized purple witch hat with lilac stars and a crescent moon, orange hat band with a gold buckle. Stylized 3D render, soft matte clay look, soft studio lighting. Full body, centered, generous margin, solid flat pure chroma green background #00FF00.
```

---

## 3. Imágenes de marca

### Icono de la app (1:1)

```text
App icon of a cute black kitten wizard's face and purple witch hat, big glowing amber-orange eyes, gold buckle on an orange hat band, bold simple shapes that stay readable at very small size, stylized 3D render, soft matte clay look, centered on a rounded square with a deep violet to indigo gradient, no text.
```

### Portada de la cinemática (16:9)

```text
A cute black kitten wizard sitting on a small weathered wooden platform in a cozy witch's attic at night, oversized purple witch hat with lilac stars and a crescent moon, orange hat band with a gold buckle, glowing amber-orange eyes. Beside it a glowing carved jack-o'-lantern and a small purple potion bottle, autumn leaves scattered on the floor. Warm candlelight mixed with cool moonlight from a round window, floating dust and golden sparkles, shallow depth of field, stylized 3D animated film look, no text.
```

---

## 4. Vídeos en bucle de los estados (image-to-video, 5 s)

Parte de la imagen del estado correspondiente. Añade esta frase al final de **todos** los prompts de esta sección:

```text
Static locked-off camera. The kitten stays in the same place. The background remains solid flat chroma green. Seamless loop: the last frame matches the first frame.
```

**Idle**

```text
The kitten breathes slowly, blinks once, one ear twitches and the tip of its tail sways gently. Calm, subtle, gentle motion.
```

**Listening**

```text
The kitten keeps its ears raised and turns them slightly toward the sound, tilts its head a little, pupils widen, soft lilac rings of light pulse outward and fade.
```

**Thinking**

```text
The kitten taps its chin slowly with one paw and glances from side to side, the hat wobbles softly, golden sparkles rise around the hat and fade away.
```

**Talking**

```text
The kitten opens and closes its mouth in a steady rhythm as if speaking, with small nods and a light paw gesture, ears and whiskers move slightly, happy expression.
```

**Sleeping**

```text
The kitten sleeps with slow deep breathing, its body rising and falling gently, an ear twitches once, a soft lilac glow pulses very slowly.
```

**Walking**

```text
The kitten walks in place in side view with a smooth, bouncy four-legged walk cycle, the tail sways and the hat bobs with each step. Treadmill-style motion, no travel across the frame.
```

---

## 5. Cinemáticas

### 5.1 Intro: "El despertar" (16:9, unos 15 s en 3 planos)

Genera cada plano por separado y únelos después. Empieza desde la imagen de portada.

**Plano 1 (5 s)**

```text
Slow cinematic push-in across a dark cozy witch's attic at night, moonlight through a round window, past autumn leaves on the floor toward a small wooden platform with a carved jack-o'-lantern and a purple potion bottle. The potion begins to glow and tiny golden sparks rise from it. Stylized 3D animated film look, magical quiet mood.
```

**Plano 2 (5 s)**

```text
The potion bottle shakes and bursts into a swirling ribbon of purple smoke and golden stars that spirals over the wooden platform. The jack-o'-lantern flares brighter. Inside the swirl, the silhouette of a small kitten wearing an oversized witch hat takes shape. Medium shot, slow orbit around the swirl, dynamic volumetric light, stylized 3D animated film look.
```

**Plano 3 (5 s)**

```text
The purple smoke clears to reveal a cute black kitten wizard sitting on the wooden platform. It opens its big glowing amber-orange eyes, looks into the camera, tilts its head and gives a small proud smile while its hat settles into place. Golden sparkles drift down. Slow push-in to a medium close-up, warm candlelight, stylized 3D animated film look. Hold the final pose for a clean ending.
```

### 5.2 Clips cortos para eventos (1:1, 3 s, fondo verde)

Parte de la imagen de idle. Añade al final:

```text
Static locked-off camera. The background remains solid flat chroma green.
```

**Aparecer**: al abrir la app

```text
A puff of purple smoke with golden stars bursts at the center of the frame. As it clears, the kitten is revealed sitting and looks up with a happy blink.
```

**Hechizo cumplido**: tarea terminada

```text
The kitten raises one paw proudly and swishes its tail, a burst of golden stars pops above its hat and falls around it, the kitten closes its eyes in a satisfied smile.
```

**Hechizo fallido**: error

```text
A small puff of grey smoke pops in front of the kitten. When it clears, the kitten has a smudge of soot on its nose, its hat droops to one side and it blinks in embarrassment. Comedic and cute.
```

**Despedida**: al cerrar la app

```text
The kitten waves one paw goodbye, tips its hat, then vanishes into a swirl of purple smoke and golden stars. The final frame shows only the empty green background.
```

---

## 6. Quitar el fondo verde

Convierte cada vídeo a WebM con transparencia. Requiere `ffmpeg`. Si quedan bordes verdes o se come parte del gato, ajusta los valores `0.16` y `0.06`.

```bash
ffmpeg -i idle.mp4 -vf "chromakey=0x00FF00:0.16:0.06,despill=type=green,format=yuva420p" -c:v libvpx-vp9 -pix_fmt yuva420p -crf 30 -b:v 0 -an idle.webm
```

## 7. Si algo sale mal

| Problema | Qué añadir o cambiar |
|---|---|
| El sombrero o la cara cambian entre imágenes | Sube la fuerza de la referencia de personaje y mantén la misma imagen maestra |
| Los bigotes se pierden al quitar el verde | Añade `slightly thicker whiskers` |
| Aparece sombra en el suelo | Añade `no ground shadow, floating on flat color` |
| El bucle da un salto | Usa la misma imagen como primer y último fotograma, y pide un movimiento más pequeño |
| El gato pierde detalle en la app | Se muestra a unos 176 × 204 px: simplifica las estrellas del sombrero |
