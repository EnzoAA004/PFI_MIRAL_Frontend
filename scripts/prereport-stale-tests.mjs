import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

/** Regresión: «desactualizado» con «Ver cambios (0)» y atribuido siempre a correcciones o contexto. */
const root = process.cwd();
const source = readFileSync(join(root, "src/features/prereport/staleExplanation.ts"), "utf8").replace(/export /g, "");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(`${js}\nexports.explainStale = explainStale;`, sandbox);
const { explainStale } = sandbox.exports;
let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log(`ok ${n} - ${name}`); };

test("sin ningún cambio identificable no hay «Ver cambios (0)» ni se atribuye a correcciones o contexto", () => {
  const e = explainStale([]);
  assert.equal(e.kind, "unidentified");
  assert.equal(e.detailCount, 0);
  assert.doesNotMatch(e.text, /correcciones o el contexto/);
  assert.match(e.text, /no se pudo identificar/);
});

test("si solo cambió el texto de generación se dice así y se aclara que el estudio no cambió", () => {
  const e = explainStale([{ section: "document" }, { section: "document" }]);
  assert.equal(e.kind, "document");
  assert.equal(e.detailCount, 2);
  assert.match(e.text, /texto con que el sistema genera/);
  assert.match(e.text, /no cambiaron/);
});

test("si cambiaron datos del estudio se mantiene el aviso de correcciones o contexto", () => {
  const e = explainStale([{ section: "measurements" }, { section: "study" }]);
  assert.equal(e.kind, "data");
  assert.match(e.text, /correcciones o el contexto/);
});

test("si cambiaron ambos se dicen las dos cosas", () => {
  const e = explainStale([{ section: "measurements" }, { section: "document" }]);
  assert.equal(e.kind, "mixed");
  assert.match(e.text, /datos del estudio/);
  assert.match(e.text, /texto con que el sistema genera/);
  assert.equal(e.detailCount, 2);
});

test("el editor usa la explicación y oculta el botón sin detalle", () => {
  const src = readFileSync(join(root, "src/features/prereport/PreReportEditor.tsx"), "utf8");
  assert.match(src, /explainStale\(view\?\.changes \?\? \[\]\)/);
  assert.match(src, /staleInfo\.detailCount > 0 &&/);
  assert.doesNotMatch(src, /Ver cambios \(\$\{view\.changes\.length\}\)/);
});

test("la nota del documento exportado sigue la misma explicación", () => {
  assert.match(explainStale([{ section: "document" }]).documentNote, /los resultados del estudio no cambiaron/);
  assert.match(explainStale([{ section: "study" }]).documentNote, /correcciones o el contexto/);
  assert.doesNotMatch(explainStale([]).documentNote, /correcciones o el contexto/);
  const html = readFileSync(join(root, "src/features/prereport/prereportHtml.ts"), "utf8");
  assert.match(html, /meta\.staleNote/);
});

console.log(`Aviso de borrador desactualizado: ${n} pruebas pasaron`);
