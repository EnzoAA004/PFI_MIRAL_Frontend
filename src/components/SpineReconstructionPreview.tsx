import type { ThreeDProxyViewModel } from "../viewModels/threeDProxyViewModel";
import { ExperimentalProxyViewer } from "./ExperimentalProxyViewer";
import { GenericAtlasPreview, type LegacyThreeDContract } from "./GenericAtlasPreview";

/**
 * Router entre las dos presentaciones 3D. Son mutuamente excluyentes por
 * diseño: cuando se provee `proxy` (un ThreeDProxyViewModel real, en cualquier
 * estado — disponible, bloqueado o con error) el atlas genérico nunca se renderiza,
 * de modo que el flujo de revisión clínica nunca pueda mostrar una malla no específica del paciente como
 * si fuera un resultado. `threeD` (forma legacy) se conserva solo para los
 * llamantes existentes que todavía proveen únicamente el payload `threeD` legacy.
 */
type Props = {
  threeD?: LegacyThreeDContract | null;
  proxy?: ThreeDProxyViewModel;
  onRetryProxy?: () => void;
  selectedStructure?: string | null;
  onSelectStructure?: (label: string | null) => void;
};

export function SpineReconstructionPreview({ threeD, proxy, onRetryProxy, selectedStructure, onSelectStructure }: Props) {
  if (proxy) return <ExperimentalProxyViewer viewModel={proxy} onRetry={onRetryProxy} selectedStructure={selectedStructure} onSelectStructure={onSelectStructure} />;
  return <GenericAtlasPreview threeD={threeD} />;
}
