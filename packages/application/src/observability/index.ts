export {
  DEFAULT_SILENCE_OWNER,
  DEFAULT_VOLUME_DROP_THRESHOLD,
  SILENCE_ALERT_KIND,
  SOURCE_SILENCE_RUNBOOK_PATH,
  buildSilenceDedupeKey,
  emitSilenceEvent,
  evaluateSilence,
  observeConnectorRunSilence,
  type RunBaselineSample,
  type SilenceAlertWriter,
  type SilenceDetectionInput,
  type SilenceEventPayload,
} from "./silence";
export { createSilenceAlertWriter } from "./writer";
