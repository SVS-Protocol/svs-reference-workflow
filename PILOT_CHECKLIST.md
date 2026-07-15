# SVS Reference Workflow Pilot Checklist

Use this checklist with one external agent and one relying party. A template,
internal demo, or passing unit test is not a completed reference workflow.

## 1. Public proposal

- [ ] Name the external agent and public bot ID.
- [ ] Provide the controller wallet public key and official Agent Registry asset.
- [ ] Name one exact action-record `txType` and explain why it is consequential.
- [ ] Name the relying party and its real pre-broadcast and post-execution boundaries.
- [ ] State the fail-closed acceptance rule.
- [ ] Keep keys, secrets, raw transaction bytes, strategy, and private evidence out of the proposal.

Open a public proposal at:

https://github.com/SVS-Protocol/svs-reference-workflow/issues/new?template=reference-workflow-proposal.yml

Use https://svsprotocol.com/get-verified when the initial coordination must be
private.

## 2. Prepare the workflow

- [ ] Clone this repository and install dependencies.
- [ ] Replace every placeholder in `workflow.manifest.json`.
- [ ] Keep `.env` local and uncommitted.
- [ ] Run `npm run check` and require `status: ready`.
- [ ] Confirm the manifest identifies an external agent, one network, one
      consequential action, and an explicit fail-closed rule.

## 3. Authorize before broadcast

- [ ] Queue the exact action through an authenticated, signed bot request.
- [ ] Complete policy, simulation, fee, and human or multisig approval checks.
- [ ] Put the exact approved serialized transaction in the local `.env` only.
- [ ] Run `npm run authorize` before signing, relaying, or broadcasting.
- [ ] Stop if authorization fails.
- [ ] Confirm the deliberate action mismatch is rejected for an SVS action-binding reason.
- [ ] Preserve `output/authorization-result.json` as the pre-execution handoff.

## 4. Execute and verify

- [ ] Execute only the exact transaction authorized in the prior step.
- [ ] Confirm broadcast and custom receipt-registry registration.
- [ ] Run the independent action-record verifier.
- [ ] Run `npm run verify`.
- [ ] Confirm the post-execution action mismatch is rejected for an SVS proof-binding reason.
- [ ] Preserve `output/verification-result.json` and the public Solana signatures.

## 5. Review and publish

- [ ] Both parties inspect the sanitized result and case-study draft.
- [ ] Remove any information not approved for publication.
- [ ] Obtain explicit approval for the agent name, relying-party name, and case study.
- [ ] Publish the inspectable result and verifier or registry link.
- [ ] Record the relying party statement that unverified automation is rejected for this workflow.

Completion requires every section. Publication intent in an issue is not final
publication approval.
