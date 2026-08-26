import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, exportNames) {
  const source = readFileSync(path, "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/export /g, "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = {
    exports: {},
    console,
    BackendApiError: class BackendApiError extends Error {},
    API_BASE_URL: "http://localhost:8080",
    authHeaders: () => ({}),
    refreshDoctorSession: async () => {},
    ensureAuthSession: async () => {},
    generateTraceId: () => "trace-test",
    multiplanarRequest: async () => ({}),
    parseLongitudinalComparisonResult: (value) => value,
  };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const api = load("src/studyReportApi.ts", ["parseStudyReport", "filenameFromDisposition", "StudyReportContractError"]);
const display = load("src/features/reading/studyReportDisplay.ts", [
  "displayReportStatus",
  "displayReportMetric",
  "displayReportPlane",
  "formatReportValue",
  "reportMeasurementLine",
  "REPORT_SAFETY_TEXT",
]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function report(overrides = {}) {
  return {
    schemaVersion: "pfi.study-report.v1",
    generatedAt: "2026-08-26T12:00:00Z",
    reportStatus: "ready",
    caseId: "CASE-88",
    studyDate: "2026-08-15",
    modality: "MRI",
    analysis: {
      analysisRunId: "run-1",
      analysisStatus: "completed",
      releaseId: "post-e50-ai-product-freeze-v1",
      createdAt: "2026-08-26T11:00:00Z",
      completedAt: "2026-08-26T11:00:02Z",
      humanReviewRequired: true,
    },
    review: {
      reviewStatus: "accepted",
      reviewComment: "Revisión completada.",
      reviewedAt: "2026-08-26T11:05:00Z",
    },
    discLevels: [{
      discLevelResultId: "level-1",
      rankIndex: 0,
      level: "L1-L2",
      localizationStatus: "localized",
      localizationSource: "ai",
      localizationValidated: true,
      abstentionPreserved: false,
      axialPairingStatus: "candidate",
      axialPairingValidated: false,
      axialPairingExperimental: true,
      axialPairingReviewRequired: true,
      degenerativeFindingsStatus: "blocked",
      automaticInferenceEnabled: false,
      reviewStatus: "observed",
      reviewComment: "Revisado.",
      reviewedAt: "2026-08-26T11:06:00Z",
    }],
    measurements: [{
      level: "L1-L2",
      plane: "sagittal",
      structure: "disc",
      metric: "areaMm2",
      unit: "mm²",
      automaticValue: 480.0,
      correctedValue: 480.5,
      effectiveValue: 480.5,
      effectiveSource: "professional_correction",
    }],
    warnings: ["axial_candidate_below_quality_gate"],
    limitations: ["Este informe corresponde a un prototipo de apoyo al análisis y no constituye un diagnóstico médico autónomo."],
    longitudinalComparison: null,
    safety: {
      humanReviewRequired: true,
      notClinicalDiagnosis: true,
      autonomousDiagnosis: false,
      disclaimer: "Este informe corresponde a un prototipo de apoyo al análisis y no constituye un diagnóstico médico autónomo.",
    },
    traceability: {
      caseId: "CASE-88",
      analysisRunId: "run-1",
      analysisSchemaVersion: "pfi.ai-product-result.v1",
      releaseId: "post-e50-ai-product-freeze-v1",
      generatedAt: "2026-08-26T12:00:00Z",
    },
    ...overrides,
  };
}

check("1. parsea el contrato versionado pfi.study-report.v1", () => {
  assert.equal(api.parseStudyReport(report()).schemaVersion, "pfi.study-report.v1");
});

check("2. rechaza schemaVersion desconocido", () => {
  assert.throws(() => api.parseStudyReport(report({ schemaVersion: "otro" })), api.StudyReportContractError);
});

check("3. exige reportStatus", () => {
  const invalid = report();
  delete invalid.reportStatus;
  assert.throws(() => api.parseStudyReport(invalid), api.StudyReportContractError);
});

check("4. preserva caseId pero no requiere subjectRef", () => {
  const parsed = api.parseStudyReport(report());
  assert.equal(parsed.caseId, "CASE-88");
  assert.equal("subjectRef" in parsed, false);
});

check("5. parsea summary de análisis", () => {
  const parsed = api.parseStudyReport(report());
  assert.equal(parsed.analysis.analysisRunId, "run-1");
  assert.equal(parsed.analysis.analysisStatus, "completed");
  assert.equal(parsed.analysis.humanReviewRequired, true);
});

check("6. parsea summary de revisión", () => {
  const parsed = api.parseStudyReport(report());
  assert.equal(parsed.review.reviewStatus, "accepted");
  assert.equal(parsed.review.reviewComment, "Revisión completada.");
});

check("7. parsea niveles discales", () => {
  const parsed = api.parseStudyReport(report());
  assert.equal(parsed.discLevels.length, 1);
  assert.equal(parsed.discLevels[0].level, "L1-L2");
  assert.equal(parsed.discLevels[0].axialPairingExperimental, true);
});

check("8. parsea medición corregida manteniendo IA original", () => {
  const parsed = api.parseStudyReport(report());
  assert.equal(parsed.measurements[0].automaticValue, 480.0);
  assert.equal(parsed.measurements[0].correctedValue, 480.5);
  assert.equal(parsed.measurements[0].effectiveValue, 480.5);
});

check("9. acepta unidad mm²", () => {
  assert.equal(api.parseStudyReport(report()).measurements[0].unit, "mm²");
});

check("10. acepta unidad mm", () => {
  const parsed = api.parseStudyReport(report({ measurements: [{ ...report().measurements[0], unit: "mm", metric: "majorAxisMm" }] }));
  assert.equal(parsed.measurements[0].unit, "mm");
});

check("11. rechaza unidad mm2 antigua en el reporte nuevo", () => {
  assert.throws(() => api.parseStudyReport(report({ measurements: [{ ...report().measurements[0], unit: "mm2" }] })), api.StudyReportContractError);
});

check("12. rechaza safety.notClinicalDiagnosis=false", () => {
  assert.throws(() => api.parseStudyReport(report({ safety: { ...report().safety, notClinicalDiagnosis: false } })), api.StudyReportContractError);
});

check("13. rechaza autonomousDiagnosis=true", () => {
  assert.throws(() => api.parseStudyReport(report({ safety: { ...report().safety, autonomousDiagnosis: true } })), api.StudyReportContractError);
});

check("14. permite no_effective_analysis sin niveles ni mediciones", () => {
  const parsed = api.parseStudyReport(report({ reportStatus: "no_effective_analysis", discLevels: [], measurements: [] }));
  assert.equal(parsed.reportStatus, "no_effective_analysis");
  assert.equal(parsed.measurements.length, 0);
});

check("15. parsea warnings", () => {
  assert.equal(api.parseStudyReport(report()).warnings[0], "axial_candidate_below_quality_gate");
});

check("16. parsea limitations", () => {
  assert.match(api.parseStudyReport(report()).limitations[0], /diagnóstico médico autónomo/);
});

check("17. conserva longitudinalComparison cuando llega", () => {
  const parsed = api.parseStudyReport(report({ longitudinalComparison: { baselineCaseId: "BASE", currentCaseId: "CASE-88", measurements: [] } }));
  assert.equal(parsed.longitudinalComparison.baselineCaseId, "BASE");
});

check("18. extrae filename RFC5987", () => {
  assert.equal(api.filenameFromDisposition("attachment; filename*=UTF-8''study-report-CASE-88.pdf"), "study-report-CASE-88.pdf");
});

check("19. extrae filename simple", () => {
  assert.equal(api.filenameFromDisposition('attachment; filename="study-report.json"'), "study-report.json");
});

check("20. display status ready", () => {
  assert.equal(display.displayReportStatus("ready"), "Listo para revisión");
});

check("21. display status no_effective_analysis", () => {
  assert.equal(display.displayReportStatus("no_effective_analysis"), "Sin análisis utilizable");
});

check("22. display metric area", () => {
  assert.equal(display.displayReportMetric("areaMm2"), "Área");
});

check("23. display plane sagittal", () => {
  assert.equal(display.displayReportPlane("sagittal"), "Sagital");
});

check("24. display plane axial", () => {
  assert.equal(display.displayReportPlane("axial"), "Axial");
});

check("25. formato valor mm² con un decimal", () => {
  assert.equal(display.formatReportValue(480.5, "mm²"), "480.5 mm²");
});

check("26. formato valor mm con dos decimales", () => {
  assert.equal(display.formatReportValue(9.8, "mm"), "9.80 mm");
});

check("27. valor null no inventa números", () => {
  assert.equal(display.formatReportValue(null, "mm"), "No disponible");
});

check("28. línea de medición muestra IA y revisor", () => {
  assert.match(display.reportMeasurementLine(report().measurements[0]), /IA 480.0 mm² → Revisor 480.5 mm²/);
});

check("29. línea de medición sin corrección no inventa revisor", () => {
  const line = display.reportMeasurementLine({ ...report().measurements[0], correctedValue: null, effectiveSource: "ai_original" });
  assert.match(line, /IA 480.0 mm²/);
  assert.equal(line.includes("Revisor"), false);
});

check("30. texto de seguridad no presenta diagnóstico final", () => {
  assert.match(display.REPORT_SAFETY_TEXT, /no constituye diagnóstico clínico autónomo/i);
});

check("31. parser no expone rawResponseSanitized", () => {
  const parsed = api.parseStudyReport(report({ rawResponseSanitized: { PatientName: "NO" } }));
  assert.equal("rawResponseSanitized" in parsed, false);
});

check("32. parser no expone PatientName aunque venga accidentalmente arriba", () => {
  const parsed = api.parseStudyReport(report({ PatientName: "NO" }));
  assert.equal("PatientName" in parsed, false);
});

console.log(`Post-E50 structured report/export (stage 88): ${passed} tests OK`);
