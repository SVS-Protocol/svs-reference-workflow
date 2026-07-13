# SVS Reference Workflow Starter

Use this starter when one external Solana agent and one relying party are ready
to prove a real acceptance rule:

> We reject this automated action unless SVS accepts the exact action record.

The runner performs two checks:

1. The expected action must pass `requireAcceptedAction`, including current
   certification, exact action binding, human approval, execution evidence,
   custom receipt-registry proof, independent verification, freshness, and the
   official Agent Registry wallet binding.
2. The same record with an altered action type must fail closed.

It then writes a sanitized JSON result and a draft case study. It never writes
API keys or request-signing secrets into either output.

## Start

```sh
npm install
cp .env.example .env
npm run validate:template
```

Replace every `replace-with-...` value in `workflow.manifest.json`, then fill
the four private values in `.env`. The protocol API credentials remain local
to the relying party and must not be committed or sent to SVS by email.

```sh
npm run check
```

The strict check must report `ready` before the relying party runs the live
workflow. It fails while any placeholder remains.

After the external action is approved, executed, registered, and independently
verified:

```sh
npm run run
```

Outputs:

- `output/verification-result.json`: exact accepted-action decision plus the
  mandatory mismatch-rejection result.
- `output/case-study.md`: sanitized case-study draft. It remains clearly marked
  as a draft until both partner names and publication are approved.

## Required public inputs

- External agent name and public bot id.
- Controller wallet public key.
- Official Agent Registry asset and network.
- Exact action-record `txType`.
- Relying party name, acceptance boundary, and fail-closed public rule.
- Certification and action-proof freshness windows.

Do not add wallet keys, API keys, signing secrets, access tokens, private bot
identifiers, strategies, or internal evidence paths to the manifest.

## Completion rule

This starter does not make a demo into a reference workflow. Publication still
requires a real external agent, a consequential action, enforcement at the
relying party's actual acceptance boundary, an accepted case, a rejected case,
independently inspectable evidence, and partner approval.
