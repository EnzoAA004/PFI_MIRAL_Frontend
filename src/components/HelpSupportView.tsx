import { HelpCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

export function HelpSupportView() {
  return (
    <div className="help-support-view">
      <section className="help-grid">
        <article className="panel-card compact-card help-card">
          <div className="section-title"><h2><HelpCircle aria-hidden size={18} /> Cómo usar MIRA·L</h2></div>
          <ol className="support-steps">
            <li>Entrar con una cuenta profesional aprobada.</li>
            <li>
              Abrir un estudio de la <strong>Lista de trabajo</strong> o cargar uno nuevo con <strong>Nuevo estudio</strong>, en tres pasos:
              <em> Paciente y estudio</em> (ID del estudio, fecha y paciente opcional), <em>Imágenes</em> (el ZIP del estudio o los archivos
              por plano) y <em>Contexto y revisión</em> (edad y contexto clínico opcionales) antes de <strong>Analizar estudio</strong>.
            </li>
            <li>En el visor, recorrer la serie, mirar las mediciones y los hallazgos de la IA y, si corresponde, corregir valores o agregar anotaciones.</li>
            <li>En <strong>Revisión</strong>, guardar el borrador o finalizar el estudio. Salir con cambios sin guardar pide confirmación.</li>
            <li>Con <strong>Preparar preinforme</strong> se arma el documento del estudio: se elige qué incluir, se edita y se exporta a PDF o HTML.</li>
          </ol>
        </article>

        <article className="panel-card compact-card help-card">
          <div className="section-title"><h2>El preinforme</h2></div>
          <ul className="check-list clean-list">
            <li>Es un <strong>borrador pendiente de revisión profesional</strong>: no está firmado, no aprueba el estudio ni cambia su revisión.</li>
            <li>Se arma con los resultados de la corrida exacta del estudio. Guardar el borrador no modifica ningún resultado.</li>
            <li>«Preinforme» incluye el contexto, el resumen, los resultados seleccionados y su evidencia; «Preinforme con anexos» suma las tablas completas y la trazabilidad técnica.</li>
            <li>Si los datos del estudio cambian después de guardar el borrador, se avisa y se actualiza solo a pedido, conservando tus ediciones.</li>
          </ul>
        </article>

        <article className="panel-card compact-card help-card">
          <div className="section-title"><h2><ShieldCheck aria-hidden size={18} /> Alcance de la plataforma</h2></div>
          <ul className="check-list clean-list">
            <li>Uso académico y de investigación.</li>
            <li>La salida del modelo es asistiva y requiere revisión humana profesional.</li>
            <li>No constituye diagnóstico clínico autónomo.</li>
            <li>Las clasificaciones degenerativas por IA son predicciones sin validación externa; el grado de Pfirrmann es experimental.</li>
          </ul>
        </article>

        <article className="panel-card compact-card help-card">
          <div className="section-title"><h2><LockKeyhole aria-hidden size={18} /> Datos y privacidad</h2></div>
          <ul className="check-list clean-list">
            <li>Los estudios se agrupan por una referencia de paciente. No cargues identificadores directos del paciente en notas, descripciones ni nombres de archivo.</li>
            <li>El sistema permite asociar un paciente a un estudio, y esos datos pueden incluir un nombre: tratá la información con las mismas precauciones que cualquier dato clínico.</li>
            <li>El documento exportable (preinforme) no incluye imágenes completas del estudio, solo los cortes y recortes de evidencia que se eligen.</li>
            <li>Antes de compartir un documento, verificá su alcance y que haya sido revisado por un profesional.</li>
          </ul>
        </article>

        <article className="panel-card compact-card help-card">
          <div className="section-title"><h2><Mail aria-hidden size={18} /> Contacto</h2></div>
          <p className="muted compact-copy">Para soporte del MVP, reportar el caso, pantalla y acción que produjo el problema al equipo responsable de MIRA·L.</p>
          <p className="settings-persistence-note">No hay sistema de tickets integrado en esta versión.</p>
        </article>
      </section>
    </div>
  );
}
