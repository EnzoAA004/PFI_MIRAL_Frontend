import {
  DISC_FINDING_TYPES,
  DISC_LEVELS,
  analysedSliceRange,
  displaySliceNumber,
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
import { DISC_COUNT_NOTE, discClassificationRows, discPositivesSummary } from "./inspectorDisplay";

type Props = {
  findings: DiscFinding[];
  contractError?: string;
  unavailableReason?: string;
  /** Resultados que no cumplieron el contrato y no se muestran (el resto sí). */
  rejectedCount?: number;
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
  if (!located) {
    const issue = findings.flatMap((finding) => finding.sources).map((source) => source.regionIssue).find(Boolean);
    return issue
      ? <p className="rr-disc-region rr-not-reported" data-testid="disc-region-issue">Región no disponible: la corrida guardó una región inválida ({issue}). Se conserva la clasificación sin localización.</p>
      : null;
  }
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
          {displaySliceNumber(located.region.sliceIndex)}
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
 * La tabla dice cuántas de las clasificaciones evaluadas dieron positivo (ver discPositivesSummary) y
 * lo aclara una sola vez debajo. "n de 4" solo aparece con las cuatro clasificaciones válidas; si falta
 * alguna, se dice cuántas se evaluaron y cuáles faltan, sin contarlas como negativas.
 */

function FindingRows({
  findings,
  homogeneousStatuses,
  nameOverride,
}: {
  findings: DiscFinding[];
  homogeneousStatuses: Map<DiscFindingType, HomogeneousStatus>;
  /** Cuando el bloque ya se titula (p. ej. "Pfirrmann"), la fila no repite el nombre. */
  nameOverride?: string;
}) {
  return (
    <div className="rr-disc-finding-rows">
      {findings.map((finding) => (
        <article className="rr-disc-finding" key={finding.findingId}>
          <span>{nameOverride ?? DISC_FINDING_LABELS[finding.findingType]}</span>
          <span className="rr-disc-finding-result">
            {homogeneousStatuses.get(finding.findingType) === "mixed" && (
              <span className={`rr-disc-deployment is-${finding.deploymentStatus}`}>
                {DEPLOYMENT_LABELS[finding.deploymentStatus]}
              </span>
            )}
            <strong>{displayDiscFindingValue(finding.label, finding.findingType)}</strong>
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

/** Las cuatro clasificaciones esperadas de un disco; la que falta se rotula "Sin dato", nunca "Ausente". */
function ClassificationRows({
  findings,
  homogeneousStatuses,
}: {
  findings: DiscFinding[];
  homogeneousStatuses: Map<DiscFindingType, HomogeneousStatus>;
}) {
  return (
    <div className="rr-disc-finding-rows">
      {discClassificationRows(findings).map((row) => {
        const finding = findings.find((item) => item.findingType === row.type && item.deploymentStatus !== "not_product_supported");
        return (
          <article className="rr-disc-finding" data-result={row.result} key={row.type}>
            <span>{row.name}</span>
            <span className="rr-disc-finding-result">
              {finding && row.result !== "missing" && homogeneousStatuses.get(finding.findingType) === "mixed" && (
                <span className={`rr-disc-deployment is-${finding.deploymentStatus}`}>
                  {DEPLOYMENT_LABELS[finding.deploymentStatus]}
                </span>
              )}
              {row.result === "missing" ? (
                <strong className="rr-not-reported">{row.rawLabel ? `Sin dato válido («${row.rawLabel}»)` : "Sin dato"}</strong>
              ) : (
                <>
                  <strong>{displayDiscFindingValue(row.result)}</strong>
                  <span className="rr-disc-confidence" title="Probabilidad de la clase informada por el modelo">
                    {row.confidence === null ? displayDiscFindingConfidence(undefined) : `prob. ${displayDiscFindingConfidence(row.confidence)}`}
                  </span>
                </>
              )}
            </span>
          </article>
        );
      })}
    </div>
  );
}

export function DiscDegenerativeFindingsPanel({
  findings,
  contractError,
  unavailableReason,
  rejectedCount = 0,
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
          {rejectedCount > 0 && (
            <p className="rr-findings-warning" data-testid="disc-rejected-note" role="status">
              {rejectedCount === 1 ? "1 resultado no cumple" : `${rejectedCount} resultados no cumplen`} el contrato y no se muestra
              {rejectedCount === 1 ? "" : "n"}; el resto sí. Su falta no equivale a «Ausente».
            </p>
          )}
          {regionNotice && <p className="rr-findings-warning" role="status">{regionNotice}</p>}

          <div className="rr-disc-overview" role="group" aria-label="Resumen de hallazgos discales por disco">
            <div className="rr-disc-overview-head" aria-hidden="true">
              <span>Disco</span>
              <span>Clasificaciones positivas</span>
              <span>Pfirrmann</span>
            </div>
            {DISC_LEVELS.map((level) => {
              const levelFindings = (groups.get(level) ?? []).filter(
                (finding) => finding.deploymentStatus !== "not_product_supported",
              );
              const summary = discPositivesSummary(levelFindings);
              const pfirrmann = levelFindings.find((finding) => finding.findingType === "pfirrmann_grade");
              return (
                <details className="rr-disc-level" data-level={level} key={level}>
                  <summary className="rr-disc-level-summary">
                    <strong>{level}</strong>
                    <span className="rr-disc-positives" data-complete={summary.complete ? "true" : "false"}>
                      {summary.text}
                      {summary.missingText && <small className="rr-disc-missing">{summary.missingText}</small>}
                    </span>
                    <span className={pfirrmann ? undefined : "rr-not-reported"}>
                      {pfirrmann ? displayDiscFindingValue(pfirrmann.label) : "Sin dato"}
                    </span>
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
                      <div className="rr-disc-block" data-block="classifications">
                        <p className="rr-disc-block-title">Clasificaciones</p>
                        <ClassificationRows findings={levelFindings} homogeneousStatuses={homogeneousStatuses} />
                      </div>
                      <div className="rr-disc-block" data-block="pfirrmann">
                        <p className="rr-disc-block-title">Pfirrmann</p>
                        {pfirrmann ? (
                          <FindingRows findings={[pfirrmann]} homogeneousStatuses={homogeneousStatuses} nameOverride="Grado" />
                        ) : (
                          <p className="rr-note rr-not-reported">Sin dato en esta corrida.</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="rr-findings-empty">Esta corrida no informa clasificaciones para este disco.</p>
                  )}
                </details>
              );
            })}
          </div>
          <p className="rr-note" data-testid="disc-count-note">{DISC_COUNT_NOTE}</p>

          {researchFindings.length > 0 && (
            <details className="rr-disc-research" data-testid="research-results">
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
        </>
      )}
    </section>
  );
}
