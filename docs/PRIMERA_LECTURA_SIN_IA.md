# Primera lectura sin IA visible

Cambio de interacción del visor: al abrir o recargar un estudio la imagen se ve **original**, sin lo que produjo la IA, y los resultados se activan con una acción explícita. No agrega funcionalidades de análisis ni cambia ningún resultado guardado.

> Esto evita la **exposición inicial automática** a las predicciones. No afirma que elimine todo sesgo de la lectura: el profesional puede activar la IA cuando quiera y el resto de la interfaz sigue rotulando los resultados como asistidos por IA que requieren revisión profesional.

## Qué cambia

| Superficie | Al abrir / recargar | Acción explícita |
|---|---|---|
| Visor individual | Sin máscara de segmentación, sin mediciones de IA, sin derivadas, sin puntos de referencia, sin leyenda ni lista de «Estructuras». | Botón **«Mostrar IA» / «Ocultar IA»** en la barra de corte (`aria-pressed`, accesible por teclado). |
| Panel de resultados | Estado compacto: «Los resultados de la IA (mediciones y hallazgos) están ocultos…». | **«Mostrar resultados de la IA»**. Abre Mediciones y Hallazgos IA con la selección y los borradores intactos (los paneles siguen montados, solo ocultos). |
| Visor dual | Ambos lados sin superposiciones; resultados comparados (Diferencias y Hallazgos IA) cerrados. | Un botón **independiente por lado** y **«Mostrar resultados comparados»**. |
| Evidencia puntual | Elegir una medición o un hallazgo muestra **solo su evidencia** (trazo o región evaluada), sin prender la segmentación. | La fila de estado «IA oculta · se muestra solo la evidencia que elegiste» trae **Ocultar evidencia / Mostrar evidencia**. |

## Reglas

- **El estado vive por encima de las pestañas** (`StudyReviewView`): cambiar de pestaña dentro del estudio conserva la elección.
- **Va atado al estudio y a la corrida** (`caso|corrida`): abrir otro estudio, reabrirlo o recargar vuelve a empezar apagado. No hay lectura ni escritura de `localStorage`, `sessionStorage` ni IndexedDB para esto: no existe una preferencia que pueda activar máscaras automáticamente.
- **Sin aparición momentánea**: el estado inicial ya es «apagado» en el primer render; la regresión e2e observa el DOM desde antes de la carga y exige que ninguna capa de IA haya aparecido ni un cuadro.
- **Mostrar/ocultar IA no cambia** corte, zoom, ventana/nivel, corrida ni correcciones; no borra resultados.
- **Las anotaciones del profesional no dependen del interruptor** («Mis mediciones» se ve siempre): no se confunden con resultados automáticos, que tienen su propia capa.
- La **línea de corte cruzado** (ayuda de orientación entre planos) no es un resultado de IA y se mantiene.
- En el dual, cambiar de referencia es abrir otro estudio: el lado de referencia vuelve a empezar sin IA y los resultados comparados se vuelven a cerrar.
- La segmentación solo existe en el corte analizado por la IA; en otro corte «Ocultar IA» no cambia nada visible (comportamiento previo).

## Archivos

- `src/components/MriSliceViewer.tsx`: props `aiVisible` y `evidenceMeasurementIds`; todo lo que dibuja la IA depende de `aiVisible`.
- `src/features/reading/PlaneViewport.tsx`: botón del interruptor y ocultamiento de «Estructuras».
- `src/components/StudyReviewView.tsx`: estado `{ key, overlays, results }`, panel compacto.
- `src/features/reading/DualComparisonView.tsx`, `ComparisonPane.tsx`: estado por lado y apertura de resultados comparados.
- `src/features/reading/reading.css`: `.rr-slice-ai-toggle`, `.rr-ai-gate`, `.viewer-ai-state`.

## Pruebas

- `scripts/ai-hidden-on-open-tests.mjs` (en `npm test`, `test:ai-hidden`): contrato de código (estado inicial apagado, sin almacenamiento, gating de cada capa, interruptor accesible, dual por lado).
- `scripts/playwright-ai-hidden-e2e.mjs` (contra el stack; solo lectura): 29 comprobaciones — sin capas de IA ni un instante, panel compacto, interruptor con teclado, conservación de corte/zoom/W-L, conservación al cambiar de pestaña, reinicio al recargar y al abrir otro estudio, dual por lado, resultados comparados a pedido, evidencia puntual. Variables: `VIEWER_URL`, `API_URL`, `SIZE`, `THEME`, `CASE`, `OTHER`, `REF`.
- Los e2e heredados que necesitan resultados abiertos usan `scripts/lib/auto-open-ai-results.mjs` (clic explícito automático) o hacen el clic en «Mostrar resultados comparados».
