# SVS Reference Workflow Starter

Use this starter when one external Solana agent and one relying party are ready
to prove a real acceptance rule:

> We reject this automated action unless SVS accepts the exact action record.

The runner enforces two phases:

1. Before broadcast, the exact serialized transaction must pass
   `requireAuthorizedAction`, including signed request, current human approval,
   simulation, fee state, transaction binding, certification, and official
   Agent Registry wallet binding. A byte-altered serialized-transaction probe
   must fail specifically at exact transaction binding.
2. After execution, the same record must pass `requireAcceptedAction`, including
   execution evidence, custom receipt-registry proof, independent verification,
   freshness, and a second altered-action rejection probe.

It then writes a sanitized JSON result and a draft case study. It never writes
API keys or request-signing secrets into either output.

## Propose a pilot

Use the structured [reference workflow proposal](https://github.com/SVS-Protocol/svs-reference-workflow/issues/new?template=reference-workflow-proposal.yml)
for public, non-secret coordination. Use the [private SVS intake](https://svsprotocol.com/get-verified)
when the initial proposal should not be public. The [pilot checklist](./PILOT_CHECKLIST.md)
defines the exact preparation, authorization, execution, verification, and
publication steps.

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

After the external action is approved, but before anyone signs, relays, or
broadcasts its exact serialized transaction:

```sh
npm run authorize
```

The relying system must stop if this command fails. A successful run writes
`output/authorization-result.json`; it contains decision and hash evidence, not
the serialized transaction or private credentials.

After that exact transaction is executed, registered, and independently
verified:

```sh
npm run verify
```

Outputs:

- `output/verification-result.json`: exact accepted-action decision plus the
  pre-execution transaction-mismatch rejection handoff and mandatory
  post-execution action-proof mismatch rejection result.
- `output/case-study.md`: sanitized case-study draft. It remains clearly marked
  as a draft until both partner names and publication are approved.

## Required public inputs

- External agent name and public bot id.
- Controller wallet public key.
- Official Agent Registry asset and network.
- Exact action-record `txType`.
- Exact approved serialized transaction, supplied privately through `.env` and
  never written into the public-safe outputs.
- Relying party name, acceptance boundary, and fail-closed public rule.
- Certification and action-proof freshness windows.

Do not add wallet keys, API keys, signing secrets, access tokens, private bot
identifiers, strategies, or internal evidence paths to the manifest.

## Completion rule

This starter does not make a demo into a reference workflow. Publication still
requires a real external agent, a consequential action, enforcement at the
relying party's actual acceptance boundary, an accepted case, a rejected case,
independently inspectable evidence, and partner approval.
