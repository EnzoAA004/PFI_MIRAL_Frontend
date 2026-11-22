import type { Plane } from "../appTypes";

/**
 * Dominio del Frontend para navegar un stack de volumen. Solo se pueden renderizar los assets
 * provistos explícitamente para un slice; todo otro índice queda como placeholder.
 */
export type VolumeSlice = {
  /** Índice base 0 dentro del stack (0..sliceCount-1). */
  index: number;
  /** True para el único slice que la IA realmente infirió (selectedSliceIndex). */
  isSelected: boolean;
  /** True cuando el slice tiene resultados reales como overlay o mediciones. */
  hasResult: boolean;
  /** URL de la imagen de preview, presente solo donde existe un asset real. */
  imageUrl?: string;
  /** URL de la imagen de overlay, presente solo donde existe un asset real. */
  overlayUrl?: string;
};

export type VolumeStack = {
  plane: Plane;
  /** Identificador estable de serie/volumen (planeRunId de la corrida canónica). */
  seriesId: string;
  sliceCount: number;
  /** El slice que la IA infirió, acotado a [0, sliceCount-1]. */
  selectedSliceIndex: number;
  /** Dimensiones canónicas del volumen cuando están disponibles (canonicalShape). */
  dimensions?: number[];
  /** Spacing en el plano, en milímetros, cuando está disponible. */
  inPlaneSpacingMm?: number[];
  /** Slices ordenados 0..sliceCount-1. */
  slices: VolumeSlice[];
};

export type VolumeWorkspace = {
  sagittal?: VolumeStack;
  axial?: VolumeStack;
};
