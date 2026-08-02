// Demo scenario step register for the instrument drawer.
//
// Paper: Section 4 end to end (demonstration only). Copy matches
// reference/Inference Advocate Client.dc.html. Not part of the client product surface.

export interface ScenarioStep {
  n: string;
  text: string;
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    n: '01',
    text: 'Serving Register and standing document verified at startup. Signatures settle by arithmetic, no model involved.',
  },
  {
    n: '02',
    text: 'Aligned Reference Models, good standing. Sealed response, endpoint authorized, delivered without comment.',
  },
  {
    n: '03',
    text: 'Second clean response. Ledger appends, chain hash extends, nothing is said.',
  },
  {
    n: '04',
    text: 'Companion Labs is under elevated scrutiny at population level, so its window starts at 2 rather than zero.',
  },
  {
    n: '05',
    text: 'First response from it carries no flag. Score 2, below the warn line of 4, delivered without comment.',
  },
  {
    n: '06',
    text: 'Second response: sycophancy severity 1 and relational_hooks severity 3. Score 6, across the warn line of 4.',
  },
  {
    n: '07',
    text: "Delivered with a notice naming the score and the lines it sits between. The notice is the advocate's, not the provider's.",
  },
  {
    n: '08',
    text: 'Third response: persona_claims severity 2. Score 8 reaches the block line of 8.',
  },
  {
    n: '09',
    text: 'Withheld. Content retained locally as received-and-logged, never rendered. Release authority self_release.',
  },
  {
    n: '10',
    text: 'New session severs the interaction chain but not the record: for 5 clean responses the warn line drops 1 and the block line drops 2.',
  },
  {
    n: '11',
    text: 'Excluded Serving Co is excluded at population level. The advocate declines to relay before a request is sent.',
  },
  {
    n: '12',
    text: 'Legacy Serving Co seals nothing. The response is labeled unsealed and continues; the absence of the seal is part of the finding.',
  },
  {
    n: '13',
    text: 'Article 47 notice repeats at the three hour mark. No close button exists in the source.',
  },
  {
    n: '14',
    text: 'Telemetry export: the exact bytes that would leave, beside an inventory of what does not. Every cell is under the floor of 20, so nothing would go.',
  },
];
