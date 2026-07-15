import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REFERENCE_WORKFLOW_AUTHORIZATION_RESULT_VERSION,
  runReferenceAuthorization,
  runReferenceWorkflow,
  validateReferenceWorkflowManifest
} from "../lib/reference-workflow.mjs";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const manifest = {
  version: "svs.reference-workflow-manifest.v1",
  workflowId: "external-treasury-transfer",
  status: "pilot",
  agent: {
    name: "External Treasury Agent",
    botId: "external-treasury-agent",
    external: true,
    controllerWallet: "ControllerWallet111111111111111111111111111",
    officialRegistry: {
      network: "devnet",
      programId: "RegistryProgram111111111111111111111111111",
      asset: "AgentAsset1111111111111111111111111111111"
    }
  },
  action: {
    txType: "transfer",
    network: "devnet",
    description: "A capped devnet treasury transfer.",
    consequentialReason: "The relying party must reject an altered transaction."
  },
  relyingParty: {
    name: "External Treasury Operator",
    type: "operator",
    acceptanceBoundary: "Before broadcast and after execution.",
    publicAcceptanceRule: "We reject unless SVS authorizes and verifies the exact action.",
    freshness: {
      certificationMaxAgeMs: 86_400_000,
      actionProofMaxAgeMs: 300_000
    }
  },
  publication: {
    agentNameApproved: false,
    relyingPartyNameApproved: false,
    caseStudyApproved: false
  }
};

describe("SVS reference workflow", () => {
  it("validates a complete external workflow manifest", () => {
    assert.equal(validateReferenceWorkflowManifest(manifest).ok, true);
  });

  it("authorizes the exact serialized transaction and proves an altered action fails", async () => {
    const calls = [];
    const result = await runReferenceAuthorization({
      manifest,
      actionRecordId: "record-1",
      serializedTransaction: "ZXhhY3QtdHJhbnNhY3Rpb24=",
      agentRegistryIdentity: { expectedNetwork: "devnet" },
      now: NOW,
      requireAuthorizedAction: async (options) => {
        calls.push(options);
        if (options.action !== "transfer") throw authorizedActionError();
        return authorizedActionResult();
      }
    });

    assert.equal(result.version, REFERENCE_WORKFLOW_AUTHORIZATION_RESULT_VERSION);
    assert.equal(result.ok, true);
    assert.equal(result.status, "authorized");
    assert.equal(result.authorizedAction.serializedTransactionHash, "b".repeat(64));
    assert.equal(result.rejectionProbe.errorName, "SvsAuthorizedActionError");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].expectedSerializedTransaction, "ZXhhY3QtdHJhbnNhY3Rpb24=");
    assert.equal(calls[0].requireTransactionBinding, true);
    assert.equal(calls[0].requireSignedRequest, true);
    assert.equal(calls[0].requireSuccessfulSimulation, true);
    assert.equal(calls[0].requireConfirmedFeePayment, true);
    assert.match(result.resultHash, /^[a-f0-9]{64}$/);
  });

  it("requires the matching authorization artifact before post-execution acceptance", async () => {
    const authorizationResult = await createAuthorizationResult();
    const result = await runReferenceWorkflow({
      manifest,
      actionRecordId: "record-1",
      authorizationResult,
      agentRegistryIdentity: { expectedNetwork: "devnet" },
      now: NOW,
      requireAcceptedAction: async (options) => {
        if (options.action !== "transfer") throw acceptedActionError();
        return acceptedActionResult();
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "verified");
    assert.equal(result.preExecutionAuthorization.resultHash, authorizationResult.resultHash);
    assert.equal(result.preExecutionAuthorization.serializedTransactionHash, "b".repeat(64));
    assert.equal(result.rejectionProbe.errorName, "SvsAcceptedActionError");
    assert.match(result.resultHash, /^[a-f0-9]{64}$/);
  });

  it("fails closed when post-execution verification lacks a matching authorization artifact", async () => {
    await assert.rejects(
      runReferenceWorkflow({
        manifest,
        actionRecordId: "record-1",
        authorizationResult: null,
        requireAcceptedAction: async () => acceptedActionResult()
      }),
      { name: "SvsReferenceWorkflowAuthorizationHandoffError" }
    );
  });

  it("fails closed when the authorization handoff is tampered", async () => {
    const authorizationResult = await createAuthorizationResult();
    authorizationResult.authorizedAction.serializedTransactionHash = "c".repeat(64);

    await assert.rejects(
      runReferenceWorkflow({
        manifest,
        actionRecordId: "record-1",
        authorizationResult,
        requireAcceptedAction: async () => acceptedActionResult()
      }),
      { name: "SvsReferenceWorkflowAuthorizationHandoffError" }
    );
  });
});

function createAuthorizationResult() {
  return runReferenceAuthorization({
    manifest,
    actionRecordId: "record-1",
    serializedTransaction: "ZXhhY3QtdHJhbnNhY3Rpb24=",
    agentRegistryIdentity: { expectedNetwork: "devnet" },
    now: NOW,
    requireAuthorizedAction: async (options) => {
      if (options.action !== "transfer") throw authorizedActionError();
      return authorizedActionResult();
    }
  });
}

function authorizedActionResult() {
  return {
    ok: true,
    decision: {
      authorized: true,
      certificationHash: "certification-hash",
      authorizationHash: "authorization-hash",
      receiptHash: "receipt-hash",
      approvalMessageHash: "approval-message-hash",
      serializedTransactionHash: "b".repeat(64)
    },
    agentRegistryIdentity: {
      ok: true,
      verificationHash: "registry-identity-hash"
    }
  };
}

function acceptedActionResult() {
  return {
    ok: true,
    decision: {
      accepted: true,
      certificationHash: "certification-hash",
      evidenceHash: "evidence-hash",
      transactionSignature: "transaction-signature",
      registryTransactionSignature: "registry-transaction-signature"
    },
    evidenceHash: "evidence-hash",
    agentRegistryIdentity: {
      ok: true,
      verificationHash: "registry-identity-hash"
    }
  };
}

function authorizedActionError() {
  const error = new Error("Action authorization failed.");
  error.name = "SvsAuthorizedActionError";
  error.details = {
    status: "rejected",
    nextAction: { code: "action_authorization_failed" },
    firstFailure: { name: "Action matches approved record" }
  };
  return error;
}

function acceptedActionError() {
  const error = new Error("Action proof verification failed.");
  error.name = "SvsAcceptedActionError";
  error.details = {
    status: "rejected",
    nextAction: { code: "action_proof_verification_failed" },
    firstFailure: { name: "Action matches production proof" }
  };
  return error;
}
