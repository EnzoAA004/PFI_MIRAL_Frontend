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
import { DecisionControl } from "./DecisionControl";
import {
  findingDecisionKey,
  type FindingDecisionMap,
  type FindingDecisionValue,
} from "./findingDecisions";

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
  /** Decisiones del profesional por hallazgo (clave `f:` + findingId). Sin entrada = sin revisar. */
  decisions?: FindingDecisionMap;
  /** Guarda la decisión de un hallazgo; `null` la quita. Si falta, los botones no se muestran. */
  onDecide?: (findingKey: string, decision: FindingDecisionValue | null) => void;
  /** Clave del hallazgo que se está guardando ahora. */
  decisionBusyKey?: string | null;
  /** La revisión está cerrada: se ven las decisiones pero no se cambian. */
  decisionsLocked?: boolean;
  decisionError?: string;
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

function compactDiscSummary(findings: DiscFinding[]): string {
  const discFindings = findings.filter((finding) => finding.findingType !== "pfirrmann_grade");
  if (!discFindings.length) return "Sin datos";
  const positives = discFindings.filter((finding) => finding.label !== "absent" && finding.label !== "none").length;
  if (!positives) return "Sin hallazgos";
  return positives === 1 ? "1 hallazgo" : `${positives} hallazgos`;
}

function DecisionButtons({
  finding,
  decisions,
  onDecide,
  busyKey,
  locked,
}: {
  finding: DiscFinding;
  decisions?: FindingDecisionMap;
  onDecide: (findingKey: string, decision: FindingDecisionValue | null) => void;
  busyKey?: string | null;
  locked?: boolean;
}) {
  const key = findingDecisionKey(finding.findingId);
  return (
    <DecisionControl
      busy={busyKey === key}
      label={DISC_FINDING_LABELS[finding.findingType]}
      locked={locked}
      onDecide={(decision) => onDecide(key, decision)}
      value={decisions?.[key]}
    />
  );
}

function FindingRows({
  findings,
  homogeneousStatuses,
  decisions,
  onDecide,
  decisionBusyKey,
  decisionsLocked,
}: {
  findings: DiscFinding[];
  homogeneousStatuses: Map<DiscFindingType, HomogeneousStatus>;
  decisions?: FindingDecisionMap;
  onDecide?: (findingKey: string, decision: FindingDecisionValue | null) => void;
  decisionBusyKey?: string | null;
  decisionsLocked?: boolean;
}) {
  return (
    <div className="rr-disc-finding-rows">
      {findings.map((finding) => (
        <div className="rr-disc-finding-block" key={finding.findingId}>
        <article className="rr-disc-finding">
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
              {displayDiscFindingConfidence(finding.confidence)}
            </span>
          </span>
        </article>
        {onDecide && (
          <DecisionButtons busyKey={decisionBusyKey} decisions={decisions} finding={finding} locked={decisionsLocked} onDecide={onDecide} />
        )}
        </div>
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
  decisions,
  onDecide,
  decisionBusyKey,
  decisionsLocked,
  decisionError,
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
          {onDecide && (
            <p className="rr-decision-help">
              Para cada hallazgo elegí <strong>Aceptar</strong>, <strong>Dudoso</strong> o <strong>Rechazar</strong>. Es tu decisión: no cambia la predicción de la IA y queda reflejada en el preinforme.
            </p>
          )}
          {decisionError && <p className="rr-findings-warning" role="alert">{decisionError}</p>}

          <div className="rr-disc-overview" role="group" aria-label="Resumen de hallazgos discales por nivel">
            <div className="rr-disc-overview-head" aria-hidden="true">
              <span>Nivel</span>
              <span>Hallazgos</span>
              <span>Pfirrmann</span>
            </div>
            {DISC_LEVELS.map((level) => {
              const levelFindings = (groups.get(level) ?? []).filter(
                (finding) => finding.deploymentStatus !== "not_product_supported",
              );
              const pfirrmann = levelFindings.find((finding) => finding.findingType === "pfirrmann_grade");
              return (
                <details className="rr-disc-level" key={level}>
                  <summary className="rr-disc-level-summary">
                    <strong>{level}</strong>
                    <span>{compactDiscSummary(levelFindings)}</span>
                    <span>{pfirrmann ? displayDiscFindingValue(pfirrmann.label) : "—"}</span>
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
                      <FindingRows decisionBusyKey={decisionBusyKey} decisions={decisions} decisionsLocked={decisionsLocked} findings={levelFindings} homogeneousStatuses={homogeneousStatuses} onDecide={onDecide} />
                    </>
                  ) : (
                    <p className="rr-findings-empty">Sin findings informados para este nivel.</p>
                  )}
                </details>
              );
            })}
          </div>

          {researchFindings.length > 0 && (
            <details className="rr-disc-research">
              <summary>
                <span>Más resultados IA</span>
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
                    <FindingRows decisionBusyKey={decisionBusyKey} decisions={decisions} decisionsLocked={decisionsLocked} findings={levelFindings} homogeneousStatuses={homogeneousStatuses} onDecide={onDecide} />
                  </section>
                );
              })}
            </details>
          )}

          <p className="rr-findings-foot">
            La revisión se registra sobre la corrida completa; los hallazgos se revisan como conjunto.
          </p>
        </>
      )}
    </section>
  );
}
