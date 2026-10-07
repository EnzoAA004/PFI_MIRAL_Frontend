/**
 * Siembra, por la API real, las fixtures sintéticas que usan los E2E `playwright-post-e50-*`
 * y emite el token de demo.
 *
 * Antes las fixtures se cargaban a mano con SQL; este script las deja reproducibles contra el
 * stack de `docker-compose.post-e50.yml` (IA y LLM simulados). Es idempotente: si el estudio
 * o el paciente ya existen, no los duplica.
 *
 *   node scripts/post-e50-e2e-seed.mjs            # imprime POST_E50_E2E_TOKEN=<token>
 *
 * Fixtures:
 * - Pacientes (entidades): PAT-86-A, PAT-86-B, PAT-86-C, PAT-87-A, con nombre sintético.
 * - Estudios con subjectRef: CASE-86-A1..A3 (PAT-86-A), CASE-86-B1 (PAT-86-B), CASE-86-C1
 *   (PAT-86-C), CASE-87-A1..A2 (PAT-87-A). Se crean con un archivo de texto, no con DICOM real.
 *
 * Los estudios se asocian por `subjectRef` (estudios históricos) y el paciente por su código:
 * al crear un estudio nuevo para el paciente PAT-87-A, el backend deriva el mismo subjectRef y
 * el historial del paciente lo incluye junto con los anteriores.
 */
const backendUrl = process.env.POST_E50_BACKEND_URL ?? "http://localhost:8180";

const PATIENTS = [
  { patientReference: "PAT-86-A", firstName: "Alma", lastName: "Sintética" },
  { patientReference: "PAT-86-B", firstName: "Bruno", lastName: "Sintético" },
  { patientReference: "PAT-86-C", firstName: "Celia", lastName: "Sintética" },
  { patientReference: "PAT-87-A", firstName: "Dora", lastName: "Sintética", dateOfBirth: "1975-03-10" },
];

const STUDIES = [
  ["CASE-86-A1", "PAT-86-A", "2026-01-10"],
  ["CASE-86-A2", "PAT-86-A", "2026-02-10"],
  ["CASE-86-A3", "PAT-86-A", "2026-03-10"],
  ["CASE-86-B1", "PAT-86-B", "2026-01-15"],
  ["CASE-86-C1", "PAT-86-C", "2026-01-20"],
  ["CASE-87-A1", "PAT-87-A", "2026-01-05"],
  ["CASE-87-A2", "PAT-87-A", "2026-02-05"],
];

async function mintToken() {
  const response = await fetch(`${backendUrl}/api/auth/demo-doctor`, { method: "POST" });
  if (!response.ok) throw new Error(`demo-doctor devolvió HTTP ${response.status}`);
  return (await response.json()).accessToken;
}

async function main() {
  const token = await mintToken();
  const auth = { Authorization: `Bearer ${token}` };

  for (const patient of PATIENTS) {
    const response = await fetch(`${backendUrl}/api/patients`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(patient),
    });
    if (response.status !== 201 && response.status !== 409) throw new Error(`crear paciente ${patient.patientReference}: HTTP ${response.status}`);
    console.error(`paciente ${patient.patientReference}: ${response.status === 201 ? "creado" : "ya existía"}`);
  }

  for (const [caseId, subjectRef, studyDate] of STUDIES) {
    const exists = await fetch(`${backendUrl}/api/studies/${caseId}`, { headers: auth });
    if (exists.ok) {
      console.error(`estudio ${caseId}: ya existía`);
      continue;
    }
    const form = new FormData();
    form.append("file", new Blob(["synthetic-test-fixture-not-real-dicom-no-patient-data"]), "synthetic-sagittal.dcm");
    form.append("caseId", caseId);
    form.append("plane", "sagittal");
    const upload = await fetch(`${backendUrl}/api/ai/inputs`, { method: "POST", headers: auth, body: form });
    if (!upload.ok) throw new Error(`cargar ${caseId}: HTTP ${upload.status}`);
    const { inputId } = await upload.json();
    // El estudio se crea al correr el analisis, igual que desde la pantalla Nuevo estudio.
    const run = await fetch(`${backendUrl}/api/ai/multiplanar/run`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId,
        studyMetadata: { subjectRef, studyDate, reviewPriority: "medium" },
        sagittalInputId: inputId,
        sagittalModelKey: "sagittal_spider",
        allowContractFallback: false,
        metadata: { source: "post-e50-e2e-seed", inferenceMode: "real_baseline", requestedInferenceMode: "real_baseline", allowContractFallback: false, axialMode: "optional_not_provided" },
      }),
    });
    if (!run.ok) throw new Error(`crear estudio ${caseId}: HTTP ${run.status} ${await run.text()}`);
    console.error(`estudio ${caseId}: creado (subjectRef ${subjectRef})`);
  }

  console.log(`POST_E50_E2E_TOKEN=${token}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
