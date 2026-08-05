// Labels for the pipeline stages the advocate reports while an exchange runs.
//
// Paper: steps 3 through 12. The ids come from ExchangeStage in the core and there is one label
// per stage that actually runs, in the order it runs. Nothing here is invented for the screen: no
// stage that does no work, and no friendly word standing in for several checks at once. The label
// carries more information than the motion beside it does, which is why it is worth being exact
// about.
//
// Vocabulary. "Content" rather than "response" or "text" wherever the thing being described is
// what a system produced. It is a small discipline and the reason to keep it is that the
// surrounding industry's vocabulary keeps drifting toward the assistant-as-someone framing, and a
// client whose whole purpose is to sit between a person and that framing should not adopt it in
// its own status line.

export const STAGE_LABELS = {
  checking_standing: "Checking the provider's standing",
  awaiting_response: 'Waiting for the provider',
  receiving: 'Receiving the response',
  response_complete: 'Response complete',
  verifying_seal: 'Verifying the provenance seal',
  evaluating_content: 'Evaluating the content against the taxonomy',
  resolving_delivery: 'Applying your delivery policy',
  recording: 'Recording the exchange in your ledger',
  delivering: 'Delivering',
} as const;

export type StageId = keyof typeof STAGE_LABELS;

export function isStageId(value: string): value is StageId {
  return Object.prototype.hasOwnProperty.call(STAGE_LABELS, value);
}
