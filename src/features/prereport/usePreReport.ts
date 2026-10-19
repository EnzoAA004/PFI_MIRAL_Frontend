import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPreReport, savePreReport, updatePreReportSources } from "./prereportApi";
import { composeBlock } from "./prereportImages";
import type { ImageState } from "./prereportHtml";
import { evidenceBlocks, sameEdits, selectedLevels, type EvidenceBlock } from "./prereportModel";
import type { PreReportEdits, PreReportGenerated, PreReportView, RenderParams } from "./prereportTypes";

/**
 * Estado del editor del preinforme: vista del Backend, ediciones locales, imágenes compuestas y guardado.
 *
 * Abrir NO escribe nada. Guardar escribe solo el borrador del preinforme. Si el borrador quedó basado en datos anteriores, el
 * contenido no cambia hasta que el profesional lo actualiza explícitamente.
 */

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}

const signatureOf = (block: EvidenceBlock) => JSON.stringify([block.imagePath, block.traces.map((t) => [t.ref, t.points, t.origin]), block.regions.map((r) => [r.ref, r.region])]);

export function usePreReport(caseId: string, runId: string) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [view, setView] = useState<PreReportView | null>(null);
  const [edits, setEdits] = useState<PreReportEdits>({});
  const [savedEdits, setSavedEdits] = useState<PreReportEdits>({});
  const [busy, setBusy] = useState<"save" | "update" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [images, setImages] = useState<Record<string, { signature: string; state: ImageState }>>({});
  const pending = useRef(new Map<string, Promise<ImageState>>());
  const scopeKey = `${caseId}|${runId}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const apply = useCallback((next: PreReportView) => {
    setView(next);
    const nextEdits = next.draft?.edits ?? {};
    setEdits(nextEdits);
    setSavedEdits(nextEdits);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "loading" });
    setView(null);
    setImages({});
    pending.current.clear();
    getPreReport(caseId, runId)
      .then((loaded) => {
        if (cancelled) return;
        apply(loaded);
        setPhase({ kind: "ready" });
      })
      .catch((error) => {
        if (!cancelled) setPhase({ kind: "error", message: messageOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [apply, caseId, runId]);

  /** Lo que se muestra: el borrador guardado (con lo generado cuando se creó o actualizó) o, sin borrador, lo generado hoy. */
  const model: PreReportGenerated | null = view ? (view.draft?.generated ?? view.generated) : null;
  const dirty = view !== null && (view.draft === null ? true : !sameEdits(edits, savedEdits));
  /** Ediciones del profesional sin guardar (contra el último borrador guardado o, sin borrador, contra lo generado). */
  const pendingEdits = view !== null && !sameEdits(edits, savedEdits);

  const blocks = useMemo(() => {
    if (!model) return [] as EvidenceBlock[];
    return selectedLevels(model, edits).flatMap((selection) => evidenceBlocks(model, edits, selection));
  }, [model, edits]);

  const compose = useCallback((block: EvidenceBlock): Promise<ImageState> => {
    const signature = signatureOf(block);
    const key = `${block.id}|${signature}`;
    const existing = pending.current.get(key);
    if (existing) return existing;
    const requestedScope = scopeRef.current;
    const promise = composeBlock(block)
      .then((image): ImageState => ({ status: "ready", image }))
      .catch((error): ImageState => ({ status: "failed", error: `${messageOf(error)}` }))
      .then((state) => {
        if (scopeRef.current === requestedScope) setImages((current) => ({ ...current, [block.id]: { signature, state } }));
        return state;
      });
    pending.current.set(key, promise);
    return promise;
  }, []);

  useEffect(() => {
    for (const block of blocks) {
      const signature = signatureOf(block);
      if (images[block.id]?.signature !== signature) void compose(block);
    }
  }, [blocks, compose, images]);

  /** Estado de cada imagen para el documento: lo que está listo, o «en preparación» si todavía no. */
  const imageStates = useMemo(() => {
    const result: Record<string, ImageState> = {};
    for (const block of blocks) {
      const entry = images[block.id];
      result[block.id] = entry && entry.signature === signatureOf(block) ? entry.state : { status: "loading" };
    }
    return result;
  }, [blocks, images]);

  /** Espera a que todas las imágenes del documento estén compuestas (o hayan fallado) y devuelve sus estados definitivos. */
  const settleImages = useCallback(async (): Promise<Record<string, ImageState>> => {
    const settled: Record<string, ImageState> = {};
    for (const block of blocks) settled[block.id] = await compose(block);
    return settled;
  }, [blocks, compose]);

  const renderParams = useMemo(() => {
    const params: Record<string, RenderParams> = {};
    for (const block of blocks) {
      const state = imageStates[block.id];
      if (state?.status === "ready") params[block.id] = state.image.params;
    }
    return params;
  }, [blocks, imageStates]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!view) return false;
    setBusy("save");
    setNotice(null);
    try {
      const next = await savePreReport(caseId, runId, view.draft?.version ?? null, { ...edits, renderParams });
      apply(next);
      setNotice({ kind: "ok", text: `Borrador guardado (versión ${next.draft?.version ?? 1}). No modifica la revisión del estudio.` });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [apply, caseId, edits, renderParams, runId, view]);

  const updateSources = useCallback(async (): Promise<boolean> => {
    if (!view?.draft) return false;
    setBusy("update");
    setNotice(null);
    try {
      let current = view;
      if (dirty) {
        current = await savePreReport(caseId, runId, view.draft.version, { ...edits, renderParams });
      }
      const next = await updatePreReportSources(caseId, runId, current.draft!.version);
      apply(next);
      setNotice({
        kind: "ok",
        text: next.orphanedEdits.length
          ? `Fuentes actualizadas. Se conservaron tus ediciones; ${next.orphanedEdits.length} refieren a elementos que ya no existen.`
          : "Fuentes actualizadas. Se conservaron tus ediciones.",
      });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [apply, caseId, dirty, edits, renderParams, runId, view]);

  const reload = useCallback(async () => {
    try {
      apply(await getPreReport(caseId, runId));
      setNotice(null);
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
    }
  }, [apply, caseId, runId]);

  return { phase, view, model, edits, setEdits, dirty, pendingEdits, busy, notice, setNotice, imageStates, blocks, settleImages, save, updateSources, reload };
}
