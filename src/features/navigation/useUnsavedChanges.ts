import { useEffect } from "react";
import { setPending } from "./unsavedChanges";

/**
 * Registra lo pendiente de una vista mientras está montada. `items` vacío = nada que proteger.
 * La lista se calcula comparando con el último estado cargado o guardado; ver `unsavedChanges.ts`.
 */
export function useUnsavedChanges(id: string, label: string, items: string[]) {
  const key = items.join("\u0001");
  useEffect(() => {
    return setPending(id, label, key ? key.split("\u0001") : []);
  }, [id, label, key]);
}
