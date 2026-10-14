import {
  DISC_FINDING_TYPES,
  DISC_LEVELS,
  analysedSliceRange,
  groupDiscFindingsByLevel,
  preferredRegion,
  type DeploymentStatus,
  type DiscFinding,
  type DiscFindingType,
  type DiscLevel,
} from "./discDegenerativeFindings";
import {
  DEPLOYMENT_LABELS,
  DISC_FINDING_LABELS,
  DISC_REGION_NOTICE,
  DISC_SERIES_ROLE_LABELS,
  displayDiscFindingConfidence,
  displayDiscFindingValue,
} from "./discFindingDisplay";
import { discClassificationScope } from "./inspectorDisplay";

type Props = {
  findings: DiscFinding[];
  contractError?: string;
  unavailableReason?: string;
  /** Serie que el visor sagital tiene a la vista, para preferirla al localizar. */
  viewedInputId?: string | null;
  /** Lleva el visor a la serie y al corte donde se evaluó el nivel. */
  onGoToRegion?: (level: DiscLevel) => void;
  /** Nivel cuya marca está dibujada ahora mismo sobre la imagen. */
  markedLevel?: DiscLevel | null;
  /** Por qué no se pudo ubicar un nivel. Se dice en vez de no hacer nada. */
  regionNotice?: string;
};

/**
 * Dónde se evaluó el nivel, y el atajo para ir a verlo.
 *
 * Nombra la secuencia y el rango de cortes en vez de un número suelto: el modelo
 * mira una ventana de tres cortes centrada en el disco, y decir "corte 8" a secas
 * afirmaría un barrido de la serie que nunca ocurrió. El botón lleva al centro de
 * esa ventana, que es el único de los tres que la localización nombra.
 */
function EvaluatedRegion({
  findings,
  level,
  viewedInputId,
  onGoToRegion,
  marked,
}: {
  findings: DiscFinding[];
  level: DiscLevel;
  viewedInputId?: string | null;
  onGoToRegion?: (level: DiscLevel) => void;
  marked: boolean;
}) {
  const located = findings.map((finding) => preferredRegion(finding, viewedInputId)).find(Boolean);
  if (!located) return null;
  const source = findings
    .flatMap((finding) => finding.sources)
    .find((item) => item.role === located.role);
  const range = source ? analysedSliceRange(source) : "";
  return (
    <p className="rr-disc-region">
      <span>
        Evaluado en {DISC_SERIES_ROLE_LABELS[located.role]}
        {range ? ` · ${range}` : ""}
      </span>
      {onGoToRegion && (
        <button
          type="button"
          aria-pressed={marked}
          onClick={() => onGoToRegion(level)}
          title={DISC_REGION_NOTICE}
        >
          {marked ? "Marcado en el corte " : "Ver en el corte "}
          {located.region.sliceIndex}
        </button>
      )}
    </p>
  );
}

type HomogeneousStatus = DeploymentStatus | "mixed";

function statusByFindingType(findings: DiscFinding[]): Map<DiscFindingType, HomogeneousStatus> {
  const result = new Map<DiscFindingType, HomogeneousStatus>();
  for (const type of DISC_FINDING_TYPES) {
    const statuses = new Set(
      findings.filter((finding) => finding.findingType === type).map((finding) => finding.deploymentStatus),
    );
    if (statuses.size === 1) result.set(type, [...statuses][0]);
    else if (statuses.size > 1) result.set(type, "mixed");
  }
  return result;
}

/*
 * El resumen del disco dice sobre QUÉ clasificaciones habla (ver discClassificationScope). Una
 * frase sin alcance se leía como "disco normal", y el modelo solo clasifica unas pocas
 * alteraciones: ausente en ellas no descarta el resto. Un disco sin ninguna clasificación
 * informada tampoco se presenta como negativo.
 */

function FindingRows({
  findings,
  homogeneousStatuses,
}: {
  findings: DiscFinding[];
  homogeneousStatuses: Map<DiscFindingType, HomogeneousStatus>;
}) {
  return (
    <div className="rr-disc-finding-rows">
      {findings.map((finding) => (
        <article className="rr-disc-finding" key={finding.findingId}>
          <span>{DISC_FINDING_LABELS[finding.findingType]}</span>
          <span className="rr-disc-finding-result">
            {homogeneousStatuses.get(finding.findingType) === "mixed" && (
              <span className={`rr-disc-deployment is-${finding.deploymentStatus}`}>
                {DEPLOYMENT_LABELS[finding.deploymentStatus]}
              </span>
            )}
            <strong>{displayDiscFindingValue(finding.label)}</strong>
            {/*
              La confianza de la etiqueta reportada, al lado del valor y no en su
              lugar: sigue siendo una clasificación con revisión humana obligatoria,
              pero sin saber cuán seguro está el modelo el lector no tiene con qué
              pesarla contra la imagen. Es la misma lectura que ya acompaña a cada
              medición.
            */}
            <span className="rr-disc-confidence" title="Probabilidad de la clase informada por el modelo">
              {typeof finding.confidence === "number" ? `prob. ${displayDiscFindingConfidence(finding.confidence)}` : displayDiscFindingConfidence(finding.confidence)}
            </span>
          </span>
        </article>
      ))}
    </div>
  );
}

export function DiscDegenerativeFindingsPanel({
  findings,
  contractError,
  unavailableReason,
  viewedInputId,
  onGoToRegion,
  markedLevel,
  regionNotice,
}: Props) {
  const groups = new Map(groupDiscFindingsByLevel(findings).map((group) => [group.level, group.findings]));
  const homogeneousStatuses = statusByFindingType(findings);
  const researchFindings = findings.filter((finding) => finding.deploymentStatus === "not_product_supported");
  return (
    <section className="rr-disc-findings" aria-label="Hallazgos discales asistidos por IA">
      <div className="rr-disc-section-head">
        <p className="rr-section-title">Hallazgos discales</p>
      </div>

      {contractError && (
        <p className="rr-disc-contract-error" role="alert">
          No se muestran los hallazgos discales: {contractError}
        </p>
      )}
      {!contractError && !findings.length && (
        <p className="rr-findings-empty">
          {unavailableReason ?? "Esta corrida no tiene hallazgos discales persistidos."}
        </p>
      )}

      {!contractError && findings.length > 0 && (
        <>
          {regionNotice && <p className="rr-findings-warning" role="status">{regionNotice}</p>}

          <div className="rr-disc-overview" role="group" aria-label="Resumen de hallazgos discales por nivel">
            <div className="rr-disc-overview-head" aria-hidden="true">
              <span>Disco</span>
              <span>Otras clasificaciones</span>
              <span>Pfirrmann</span>
            </div>
            {DISC_LEVELS.map((level) => {
              const levelFindings = (groups.get(level) ?? []).filter(
                (finding) => finding.deploymentStatus !== "not_product_supported",
              );
              const scope = discClassificationScope(levelFindings);
              const pfirrmann = levelFindings.find((finding) => finding.findingType === "pfirrmann_grade");
              const otherFindings = levelFindings.filter((finding) => finding.findingType !== "pfirrmann_grade");
              return (
                <details className="rr-disc-level" key={level}>
                  <summary className="rr-disc-level-summary">
                    <strong>{level}</strong>
                    <span>{scope.summary}</span>
                    <span>{pfirrmann ? `Pfirrmann ${displayDiscFindingValue(pfirrmann.label)}` : "Sin Pfirrmann"}</span>
                  </summary>
                  {levelFindings.length ? (
                    <>
                      <EvaluatedRegion
                        findings={levelFindings}
                        level={level}
                        marked={markedLevel === level}
                        onGoToRegion={onGoToRegion}
                        viewedInputId={viewedInputId}
                      />
                      {pfirrmann && (
                        <div className="rr-disc-block" data-block="pfirrmann">
                          <p className="rr-disc-block-title">Clasificación de Pfirrmann</p>
                          <FindingRows findings={[pfirrmann]} homogeneousStatuses={homogeneousStatuses} />
                        </div>
                      )}
                      {otherFindings.length > 0 && (
                        <div className="rr-disc-block" data-block="other">
                          <p className="rr-disc-block-title">Otras clasificaciones del disco</p>
                          <FindingRows findings={otherFindings} homogeneousStatuses={homogeneousStatuses} />
                        </div>
                      )}
                      {scope.scopeNote && <p className="rr-note" data-testid="disc-scope-note">{scope.scopeNote}</p>}
                    </>
                  ) : (
                    <p className="rr-findings-empty">Esta corrida no informa clasificaciones para este disco.</p>
                  )}
                </details>
              );
            })}
          </div>

          {researchFindings.length > 0 && (
            <details className="rr-disc-research">
              <summary>
                <span>Resultados de investigación (no soportados para uso clínico)</span>
              </summary>
              <p className="rr-disc-research-note">
                Estas capacidades se conservan para análisis de investigación y todavía no
                forman parte del conjunto principal de funciones soportadas.
              </p>
              {DISC_LEVELS.map((level) => {
                const levelFindings = researchFindings.filter((finding) => finding.level === level);
                if (!levelFindings.length) return null;
                return (
                  <section className="rr-disc-research-level" key={level}>
                    <h4>{level}</h4>
                    <FindingRows findings={levelFindings} homogeneousStatuses={homogeneousStatuses} />
                  </section>
                );
              })}
            </details>
          )}

          <p className="rr-findings-foot">
            Estos resultados se revisan junto con la corrida del análisis inicial, en la pestaña Revisión; no hay revisión por hallazgo.
          </p>
        </>
      )}
    </section>
  );
}
