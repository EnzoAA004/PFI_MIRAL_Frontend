/**
 * Los estudios se abren sin IA visible y con los resultados cerrados («Mostrar resultados de la IA»). Los e2e que NO
 * prueban esa primera lectura sino otra cosa (correcciones, preinforme, comparación de mediciones…) necesitan los
 * resultados abiertos para trabajar: este init script hace por ellos el clic explícito apenas aparece el aviso.
 * No usarlo en `playwright-ai-hidden-e2e.mjs`, que justamente comprueba que nada se abre solo.
 */
export async function autoOpenAiResults(context) {
  await context.addInitScript(() => {
    const openIfPresent = () => {
      const button = document.querySelector('[data-testid="ai-results-open"]');
      if (button instanceof HTMLElement && button.offsetParent !== null) button.click();
    };
    new MutationObserver(openIfPresent).observe(document, { childList: true, subtree: true });
  });
}
