/*
 * El tema es una sola preferencia para todo el producto: superficie operativa y
 * sala de lectura. Lo que este archivo protege es que la sala siga teniendo las
 * dos escalas, que el viewport no se aclare con el marco y que la preferencia no
 * vuelva a vivir en el estado local de cada botón.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tokens = readFileSync("src/design/tokens.css", "utf8");
const theme = readFileSync("src/design/theme.ts", "utf8");
const shell = readFileSync("src/features/reading/ReadingWorkspaceShell.tsx", "utf8");
const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
const review = readFileSync("src/components/StudyReviewView.tsx", "utf8");
const readingCss = readFileSync("src/features/reading/reading.css", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const auth = readFileSync("src/components/AuthView.tsx", "utf8");

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

test("la sala de lectura declara las dos escalas de tema", () => {
  assert.match(tokens, /\[data-theme="reading"\]\s*\{/);
  assert.match(tokens, /\[data-theme="reading-light"\]\s*\{/);
});

test("el tema claro de la sala no aclara el viewport", () => {
  const light = tokens.slice(tokens.indexOf('[data-theme="reading-light"]'));
  assert.match(light, /--viewport-bg:\s*#000000;/);
  // Las anotaciones quemadas sobre la imagen siguen siendo las del fondo negro.
  assert.match(light, /--viewport-annotation:\s*#B9C4D2;/);
});

test("el tema claro de la sala declara color-scheme light", () => {
  const light = tokens.slice(tokens.indexOf('[data-theme="reading-light"]'));
  assert.match(light, /color-scheme:\s*light;/);
});

test("el shell de lectura resuelve el atributo desde la preferencia", () => {
  assert.match(shell, /readingThemeAttribute\(theme\)/);
  assert.doesNotMatch(shell, /data-theme="reading"/);
  assert.match(theme, /readingThemeAttribute/);
  assert.match(theme, /theme === "light" \? "reading-light" : "reading"/);
});

test("la preferencia es compartida, no estado local de cada botón", () => {
  assert.match(theme, /export function setTheme/);
  assert.match(theme, /export function useTheme/);
  for (const source of [sidebar, shell]) {
    assert.match(source, /useTheme\(\)/);
    assert.doesNotMatch(source, /useState<OperationsTheme>/);
  }
});

test("la sala inmersiva ofrece su propio alternador", () => {
  assert.match(shell, /export function ReadingThemeToggle/);
  assert.match(review, /<ReadingThemeToggle \/>/);
  assert.match(readingCss, /\.rr-theme-toggle\s*\{/);
});

/*
 * La regresión que motiva estos tres: en tema claro las leyendas flotantes
 * heredaban el texto casi negro del marco y quedaban ilegibles sobre el panel
 * negro que las apoya.
 */
test("la capa sobre la imagen usa la escala oscura también en tema claro", () => {
  const scope = readingCss.slice(readingCss.indexOf('[data-theme="reading-light"] :is('));
  for (const selector of [".rr-corner", ".rr-scalebar", ".rr-orientation", ".rr-viewport-role",
                          ".real-slice-frame", ".rr-instances-panel", ".segmentation-legend-panel"]) {
    assert.ok(scope.includes(selector), `falta ${selector} en la capa sobre la imagen`);
  }
  // Los mismos valores que [data-theme="reading"]: sobre la imagen los dos temas
  // se ven idénticos.
  assert.match(scope, /--text:\s*#E6EAF0;/);
  assert.match(scope, /--text-muted:\s*#8B96A5;/);
  assert.match(scope, /--text-primary-strong:\s*#8FB6FA;/);
  // Casillas y barra de desplazamiento las pinta el navegador, no la hoja.
  assert.match(scope, /color-scheme:\s*dark;/);
});

test("el color heredado se fija en la raíz de cada bloque sobre la imagen", () => {
  // La herencia transporta el color resuelto, no la referencia al token: sin
  // esto, lo que no tiene regla propia se queda con el texto del marco claro.
  const rootRule = readingCss.slice(readingCss.lastIndexOf('[data-theme="reading-light"] :is('));
  assert.match(rootRule, /\.real-slice-frame,/);
  assert.match(rootRule, /color:\s*var\(--text\);/);
});

test("la capa sobre la imagen no impone color a cada elemento", () => {
  // Fijar `color` en la lista completa gana por especificidad sobre la regla
  // propia de cada elemento y aplana la jerarquía de énfasis.
  const scope = readingCss.slice(readingCss.indexOf('[data-theme="reading-light"] :is('));
  const firstBlock = scope.slice(0, scope.indexOf("}") + 1);
  assert.ok(!/(^|\s)color:\s*var\(--text\);/m.test(firstBlock), "la capa no debe fijar color");
});

test("el texto sobre --primary sale de un token y no de un hex fijo", () => {
  assert.match(tokens, /--on-primary:/);
  assert.doesNotMatch(readingCss, /color:\s*#08121f/i);
  assert.match(readingCss, /color:\s*var\(--on-primary\)/);
});

test("el producto se llama MIRA·L", () => {
  assert.match(indexHtml, /MIRA·L/);
  assert.match(sidebar, /<strong>MIRA·L<\/strong>/);
  assert.match(auth, /Mapeo Integrado y Revisión Anatómica Lumbar/);
  for (const source of [sidebar, auth]) assert.doesNotMatch(source, /Plataforma de análisis de RM lumbar/);
});

console.log(`theme-dual-mode: ${count} passed`);
