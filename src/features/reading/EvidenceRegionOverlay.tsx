import { useAuthenticatedImageUrl } from "../../authenticatedAssets";
import type { VisualEvidenceItem } from "../../contracts/visualEvidenceTypes";
import { displayReportPlane } from "./studyReportDisplay";
import {
  EXPERIMENTAL_BADGE_TEXT,
  NO_BASE_IMAGE_MESSAGE,
  evidenceAriaLabel,
  evidenceBaseImageSliceUrl,
  evidenceMaskAssetUrl,
  evidenceVisualGroup,
  displayEvidenceReviewStatus,
  displayEvidenceSource,
} from "./visualEvidenceDisplay";

/**
 * EXT-04B3/EXT-04B3.5: renderizado de solo lectura de un `VisualEvidenceItem` — BBOX/ELLIPSE/POLYGON como
 * formas SVG sobre una imagen de slice base real, MASK_REFERENCE como su propio asset raster autenticado.
 * Sin ninguna interacción de dibujo, arrastre, redimensionado o creación de regiones (eso es EXT-04B5); este
 * componente nunca acepta una prop con forma de `onChange`.
 *
 * Reutiliza la propia convención de `MeasurementLayer.tsx` para la base canónica: un SVG con
 * `viewBox="0 0 256 256"` y `preserveAspectRatio="none"`, posicionado de forma absoluta sobre su
 * contenedor (`.evidence-region-overlay` replica `.mri-measure-layer` en `reading.css`) — el
 * navegador hace el escalado de 0..256 al viewport, así que este componente nunca calcula una posición
 * en píxeles CSS por sí mismo y sigue funcionando si se redimensiona el contenedor.
 *
 * La imagen base (ya sea el asset MASK_REFERENCE o el slice `baseImage` de EXT-04B3.5) se
 * obtiene mediante `useAuthenticatedImageUrl` — el mismo mecanismo de fetch autenticado/object-URL/caché
 * que `MriSliceViewer.tsx` ya usa para todo otro asset protegido. Un
 * `<img src={backendUrl}>` común no enviaría ningún header `Authorization` y simplemente fallaría contra un
 * Backend real; reutilizar este hook en lugar de un `<img>` pelado fue un bug real corregido al conectar
 * EXT-04B3.5 (se había enviado un `<img>` crudo para MASK_REFERENCE en la iteración de EXT-04B3, antes de que
 * hubiera alguna imagen base alcanzable de punta a punta como para exponer la brecha).
 */
export function EvidenceRegionOverlay({ item }: { item: VisualEvidenceItem }) {
  const group = evidenceVisualGroup(item.source);
  const imageUrl = resolveEvidenceBaseImageUrl(item);
  const image = useAuthenticatedImageUrl(imageUrl);

  return (
    <figure
      className={`evidence-region-figure evidence-region-${group}${item.experimental ? " is-experimental" : ""}`}
      aria-label={evidenceAriaLabel(item)}
    >
      {/* role="img" ya lo anuncia un lector de pantalla sin necesitar foco de teclado:
          no es interactivo (solo lectura, EXT-04B3), así que no lleva tabIndex. */}
      <div className="evidence-region-frame" role="img" aria-label={evidenceAriaLabel(item)}>
        {image.state === "loaded" && image.url ? (
          <img
            className="evidence-region-base-img"
            data-testid="evidence-region-base-img"
            src={image.url}
            alt=""
            draggable={false}
          />
        ) : (
          <div className="evidence-region-no-base" data-testid="evidence-region-no-base" aria-hidden="true">
            <span>{image.state === "loading" ? "Cargando imagen base..." : NO_BASE_IMAGE_MESSAGE}</span>
          </div>
        )}
        <svg className="evidence-region-overlay" viewBox="0 0 256 256" preserveAspectRatio="none" aria-hidden="true">
          <EvidenceGeometryShape item={item} />
        </svg>
      </div>
      <figcaption className="evidence-region-caption">
        <span className={`evidence-region-badge evidence-region-badge-${group}`}>{displayEvidenceSource(item.source)}</span>
        {item.experimental && <span className="evidence-region-badge evidence-region-badge-experimental">{EXPERIMENTAL_BADGE_TEXT}</span>}
        <span className="evidence-region-meta">
          {item.level ?? "Sin nivel"} · {displayReportPlane(item.plane)}
          {item.structure ? ` · ${item.structure}` : ""} · {displayEvidenceReviewStatus(item.reviewStatus)}
        </span>
        <span className="evidence-region-label">{item.label}</span>
        {item.warning && <span className="evidence-region-warning">{item.warning}</span>}
      </figcaption>
    </figure>
  );
}

/**
 * El propio asset de MASK_REFERENCE tiene prioridad cuando está presente — la máscara ES la imagen base de
 * esa geometría, según el diseño existente de EXT-04B2. En caso contrario recurre a la referencia de slice
 * `baseImage` de EXT-04B3.5 cuando el Backend resolvió una. Devuelve `undefined` (nunca una
 * URL adivinada) cuando ninguna aplica — `useAuthenticatedImageUrl(undefined)` informa `"idle"`,
 * que este componente renderiza como el mensaje de fallback neutral.
 */
export function resolveEvidenceBaseImageUrl(item: VisualEvidenceItem): string | undefined {
  if (item.geometry.type === "MASK_REFERENCE") return evidenceMaskAssetUrl(item.geometry);
  if (item.baseImage) return evidenceBaseImageSliceUrl(item.baseImage);
  return undefined;
}

function EvidenceGeometryShape({ item }: { item: VisualEvidenceItem }) {
  const geometry = item.geometry;
  const className = `evidence-region-shape evidence-region-shape-${evidenceVisualGroup(item.source)}`;
  if (geometry.type === "BBOX") {
    return <rect className={className} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} />;
  }
  if (geometry.type === "ELLIPSE") {
    return <ellipse className={className} cx={geometry.centerX} cy={geometry.centerY} rx={geometry.radiusX} ry={geometry.radiusY} />;
  }
  if (geometry.type === "POLYGON") {
    return <polygon className={className} points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")} />;
  }
  // MASK_REFERENCE: la máscara en sí ya es la imagen raster compuesta (`evidence-region-base-img`
  // arriba) — no hay ninguna forma vectorial adicional para dibujar encima de ella acá.
  return null;
}
