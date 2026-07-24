import { createHash } from "node:crypto";

export const REFERENCE_WORKFLOW_MANIFEST_VERSION = "svs.reference-workflow-manifest.v1";
export const REFERENCE_WORKFLOW_AUTHORIZATION_RESULT_VERSION = "svs.reference-workflow-authorization-result.v1";
export const REFERENCE_WORKFLOW_RESULT_VERSION = "svs.reference-workflow-result.v1";

const ALLOWED_STATUSES = new Set(["candidate", "pilot", "partner", "production"]);
const ALLOWED_RELYING_PARTY_TYPES = new Set(["protocol", "wallet", "treasury", "operator", "agent-platform"]);
const PLACEHOLDER_PATTERN = /(?:replace[- ]with|<[^>]+>|example(?:-|\.)|your[-_ ])/i;
const SECRET_KEY_PATTERN = /(?:api.?key|secret|private.?key|mnemonic|seed|token)$/i;

export function validateReferenceWorkflowManifest(manifest, { allowPlaceholders = false } = {}) {
  const issues = [];
  const placeholderPaths = [];
  const requireText = (path, value) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) issues.push({ path, code: "required", message: `${path} is required.` });
    if (text && PLACEHOLDER_PATTERN.test(text)) {
      placeholderPaths.push(path);
      if (!allowPlaceholders) {
        issues.push({ path, code: "placeholder", message: `${path} still contains placeholder material.` });
      }
    }
    return text;
  };

  if (manifest?.version !== REFERENCE_WORKFLOW_MANIFEST_VERSION) {
    issues.push({ path: "version", code: "unsupported_version", message: `Expected ${REFERENCE_WORKFLOW_MANIFEST_VERSION}.` });
  }
  requireText("workflowId", manifest?.workflowId);
  if (!ALLOWED_STATUSES.has(manifest?.status)) {
    issues.push({ path: "status", code: "invalid_status", message: "status must be candidate, pilot, partner, or production." });
  }

  requireText("agent.name", manifest?.agent?.name);
  requireText("agent.botId", manifest?.agent?.botId);
  requireText("agent.controllerWallet", manifest?.agent?.controllerWallet);
  if (manifest?.agent?.external !== true) {
    issues.push({ path: "agent.external", code: "external_agent_required", message: "The reference workflow agent must be external to SVS." });
  }
  requireText("agent.officialRegistry.network", manifest?.agent?.officialRegistry?.network);
  requireText("agent.officialRegistry.programId", manifest?.agent?.officialRegistry?.programId);
  requireText("agent.officialRegistry.asset", manifest?.agent?.officialRegistry?.asset);

  requireText("action.txType", manifest?.action?.txType);
  requireText("action.network", manifest?.action?.network);
  requireText("action.description", manifest?.action?.description);
  requireText("action.consequentialReason", manifest?.action?.consequentialReason);
  if (
    manifest?.action?.network &&
    manifest?.agent?.officialRegistry?.network &&
    manifest.action.network !== manifest.agent.officialRegistry.network
  ) {
    issues.push({ path: "action.network", code: "network_mismatch", message: "Action and official registry networks must match." });
  }

  requireText("relyingParty.name", manifest?.relyingParty?.name);
  if (!ALLOWED_RELYING_PARTY_TYPES.has(manifest?.relyingParty?.type)) {
    issues.push({ path: "relyingParty.type", code: "invalid_type", message: "Unsupported relying-party type." });
  }
  requireText("relyingParty.acceptanceBoundary", manifest?.relyingParty?.acceptanceBoundary);
  const acceptanceRule = requireText("relyingParty.publicAcceptanceRule", manifest?.relyingParty?.publicAcceptanceRule);
  if (acceptanceRule && !/reject/i.test(acceptanceRule)) {
    issues.push({ path: "relyingParty.publicAcceptanceRule", code: "fail_closed_rule_required", message: "The public rule must explicitly reject actions that do not pass SVS." });
  }

  for (const [path, value] of [
    ["relyingParty.freshness.certificationMaxAgeMs", manifest?.relyingParty?.freshness?.certificationMaxAgeMs],
    ["relyingParty.freshness.actionProofMaxAgeMs", manifest?.relyingParty?.freshness?.actionProofMaxAgeMs]
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      issues.push({ path, code: "invalid_freshness", message: `${path} must be a positive integer.` });
    }
  }

  findSecretFields(manifest, "", issues);
  const templateReady = allowPlaceholders && issues.length === 0 && placeholderPaths.length > 0;
  return {
    version: "svs.reference-workflow-manifest-validation.v1",
    ok: issues.length === 0,
    status: issues.length === 0 ? (templateReady ? "template_ready" : "ready") : "not_ready",
    workflowId: manifest?.workflowId ?? null,
    issueCount: issues.length,
    issues,
    placeholderPaths,
    nextAction: issues.length === 0
      ? templateReady
        ? { code: "replace_manifest_placeholders", message: "Starter structure is valid. Replace all placeholders, then run the strict check." }
        : { code: "run_reference_workflow", message: "Manifest is ready for a real accepted-action and rejection-probe run." }
      : { code: "complete_reference_workflow_manifest", message: "Replace placeholders and fix all manifest issues before running the workflow." }
  };
}

export async function runReferenceAuthorization({
  manifest,
  actionRecordId,
  serializedTransaction,
  requireAuthorizedAction,
  agentRegistryIdentity,
  now = new Date()
}) {
  const validation = validateReferenceWorkflowManifest(manifest);
  if (!validation.ok) {
    const error = new Error("Reference workflow manifest is not ready.");
    error.name = "SvsReferenceWorkflowManifestError";
    error.details = validation;
    throw error;
  }
  if (!actionRecordId) throw new Error("actionRecordId is required.");
  if (!serializedTransaction) throw new Error("serializedTransaction is required for pre-broadcast authorization.");
  if (typeof requireAuthorizedAction !== "function") throw new Error("requireAuthorizedAction is required.");

  const common = {
    botId: manifest.agent.botId,
    agentWallet: manifest.agent.controllerWallet,
    actionRecordId,
    expectedSerializedTransaction: serializedTransaction,
    certificationStaleAfterMs: manifest.relyingParty.freshness.certificationMaxAgeMs,
    approvalStaleAfterMs: manifest.relyingParty.freshness.actionProofMaxAgeMs,
    requestTimestampMaxAgeMs: manifest.relyingParty.freshness.actionProofMaxAgeMs,
    requireCurrentIntegrationContract: true,
    requireTransactionBinding: true,
    requireSignedRequest: true,
    requireSuccessfulSimulation: true,
    requireConfirmedFeePayment: true,
    agentRegistryIdentity,
    now
  };
  const authorization = await requireAuthorizedAction({ ...common, action: manifest.action.txType });
  if (authorization?.ok !== true || authorization?.decision?.authorized !== true) {
    throw new Error("Expected action did not return an authorized SVS decision.");
  }
  if (authorization?.agentRegistryIdentity?.ok !== true) {
    throw new Error("Expected action did not return a verified official Agent Registry identity binding.");
  }

  const mismatchedSerializedTransaction = createMismatchedSerializedTransaction(serializedTransaction);
  let rejection;
  try {
    await requireAuthorizedAction({
      ...common,
      action: manifest.action.txType,
      expectedSerializedTransaction: mismatchedSerializedTransaction
    });
    throw new Error("Serialized-transaction mismatch probe was unexpectedly accepted.");
  } catch (error) {
    if (error?.message === "Serialized-transaction mismatch probe was unexpectedly accepted.") throw error;
    rejection = {
      probeType: "serialized_transaction_mismatch",
      ...sanitizeRejection(error)
    };
    if (
      rejection.errorName !== "SvsAuthorizedActionError" ||
      rejection.failureCode !== "action_authorization_failed" ||
      rejection.failedCheck !== "Exact serialized transaction"
    ) {
      throw new Error(
        `Serialized-transaction mismatch probe did not fail at exact transaction binding: ${rejection.failedCheck ?? rejection.errorName}.`
      );
    }
  }

  const result = {
    version: REFERENCE_WORKFLOW_AUTHORIZATION_RESULT_VERSION,
    ok: true,
    status: "authorized",
    checkedAt: new Date(now).toISOString(),
    workflow: summarizeWorkflow(manifest),
    officialRegistry: {
      programId: manifest.agent.officialRegistry.programId,
      asset: manifest.agent.officialRegistry.asset,
      network: manifest.agent.officialRegistry.network,
      verificationHash: authorization.agentRegistryIdentity?.verificationHash ?? null
    },
    authorizedAction: {
      authorized: true,
      recordId: actionRecordId,
      certificationHash: authorization?.decision?.certificationHash ?? null,
      authorizationHash: authorization?.decision?.authorizationHash ?? null,
      receiptHash: authorization?.decision?.receiptHash ?? null,
      approvalMessageHash: authorization?.decision?.approvalMessageHash ?? null,
      serializedTransactionHash: authorization?.decision?.serializedTransactionHash ?? null
    },
    rejectionProbe: rejection
  };
  result.resultHash = hashObject(result);
  return result;
}

export async function runReferenceWorkflow({
  manifest,
  actionRecordId,
  authorizationResult,
  requireAcceptedAction,
  agentRegistryIdentity,
  now = new Date()
}) {
  const validation = validateReferenceWorkflowManifest(manifest);
  if (!validation.ok) {
    const error = new Error("Reference workflow manifest is not ready.");
    error.name = "SvsReferenceWorkflowManifestError";
    error.details = validation;
    throw error;
  }
  if (!actionRecordId) throw new Error("actionRecordId is required.");
  validateAuthorizationHandoff({ manifest, actionRecordId, authorizationResult });
  if (typeof requireAcceptedAction !== "function") throw new Error("requireAcceptedAction is required.");

  const common = {
    botId: manifest.agent.botId,
    agentWallet: manifest.agent.controllerWallet,
    actionRecordId,
    certificationStaleAfterMs: manifest.relyingParty.freshness.certificationMaxAgeMs,
    actionProofStaleAfterMs: manifest.relyingParty.freshness.actionProofMaxAgeMs,
    requireCurrentIntegrationContract: true,
    checkReceiptRegistryChain: true,
    agentRegistryIdentity,
    now
  };
  const acceptance = await requireAcceptedAction({ ...common, action: manifest.action.txType });
  if (acceptance?.ok !== true || acceptance?.decision?.accepted !== true) {
    throw new Error("Expected action did not return an accepted SVS decision.");
  }
  if (acceptance?.agentRegistryIdentity?.ok !== true) {
    throw new Error("Expected action did not return a verified official Agent Registry identity binding.");
  }
  let rejection;
  try {
    await requireAcceptedAction({ ...common, action: `${manifest.action.txType}-mismatch-probe` });
    throw new Error("Mismatch probe was unexpectedly accepted.");
  } catch (error) {
    if (error?.message === "Mismatch probe was unexpectedly accepted.") throw error;
    rejection = {
      probeType: "action_type_mismatch",
      ...sanitizeRejection(error)
    };
    if (
      rejection.errorName !== "SvsAcceptedActionError" ||
      rejection.failureCode !== "action_proof_verification_failed"
    ) {
      throw new Error(`Mismatch probe did not produce an action-bound SVS rejection: ${rejection.errorName}.`);
    }
  }

  const result = {
    version: REFERENCE_WORKFLOW_RESULT_VERSION,
    ok: true,
    status: "verified",
    checkedAt: new Date(now).toISOString(),
    workflow: summarizeWorkflow(manifest),
    preExecutionAuthorization: {
      resultHash: authorizationResult.resultHash,
      authorizationHash: authorizationResult.authorizedAction.authorizationHash,
      serializedTransactionHash: authorizationResult.authorizedAction.serializedTransactionHash,
      rejectionProbe: authorizationResult.rejectionProbe
    },
    officialRegistry: {
      programId: manifest.agent.officialRegistry.programId,
      asset: manifest.agent.officialRegistry.asset,
      network: manifest.agent.officialRegistry.network,
      verificationHash: acceptance.agentRegistryIdentity?.verificationHash ?? null
    },
    acceptedAction: {
      accepted: acceptance?.decision?.accepted === true,
      recordId: actionRecordId,
      certificationHash: acceptance?.decision?.certificationHash ?? null,
      evidenceHash: acceptance?.decision?.evidenceHash ?? acceptance?.evidenceHash ?? null,
      transactionSignature: acceptance?.decision?.transactionSignature ?? null,
      registryTransactionSignature: acceptance?.decision?.registryTransactionSignature ?? null
    },
    rejectionProbe: rejection,
    publication: {
      agentNameApproved: manifest.publication?.agentNameApproved === true,
      relyingPartyNameApproved: manifest.publication?.relyingPartyNameApproved === true,
      caseStudyApproved: manifest.publication?.caseStudyApproved === true,
      publishable: manifest.publication?.agentNameApproved === true &&
        manifest.publication?.relyingPartyNameApproved === true &&
        manifest.publication?.caseStudyApproved === true
    }
  };
  result.resultHash = hashObject(result);
  return result;
}

export function createCaseStudyMarkdown(result) {
  const publicationStatus = result.publication?.publishable ? "Partner-approved" : "Draft - partner approval required";
  return `# ${result.workflow.agentName} x ${result.workflow.relyingPartyName}: SVS Reference Workflow\n\n` +
    `Status: ${publicationStatus}\n\n` +
    `## Acceptance rule\n\n> ${result.workflow.publicAcceptanceRule}\n\n` +
    `## Workflow\n\n` +
    `- External agent: ${result.workflow.agentName} (\`${result.workflow.botId}\`)\n` +
    `- Consequential action: \`${result.workflow.actionType}\` on \`${result.workflow.network}\`\n` +
    `- Relying party: ${result.workflow.relyingPartyName}\n` +
    `- Acceptance boundary: ${result.workflow.acceptanceBoundary}\n` +
    `- Official Agent Registry asset: \`${result.officialRegistry.asset}\`\n` +
    `- SVS action record: \`${result.acceptedAction.recordId}\`\n\n` +
    `## Verified outcome\n\n` +
    `The exact serialized transaction passed SVS authorization before broadcast. A deliberately altered serialized transaction was rejected at the transaction-binding check. After execution, the same action passed certification, proof freshness, execution binding, custom receipt-registry, independent verification, and official identity checks, while an altered action type was rejected by the action-proof binding check.\n\n` +
    `- Pre-execution authorization result: \`${result.preExecutionAuthorization.resultHash}\`\n` +
    `- Authorized transaction hash: \`${result.preExecutionAuthorization.serializedTransactionHash}\`\n` +
    `- Transaction: \`${result.acceptedAction.transactionSignature ?? "not disclosed"}\`\n` +
    `- Registry transaction: \`${result.acceptedAction.registryTransactionSignature ?? "not disclosed"}\`\n` +
    `- Evidence hash: \`${result.acceptedAction.evidenceHash}\`\n` +
    `- Result hash: \`${result.resultHash}\`\n`;
}

function summarizeWorkflow(manifest) {
  return {
    workflowId: manifest.workflowId,
    status: manifest.status,
    agentName: manifest.agent.name,
    botId: manifest.agent.botId,
    externalAgent: true,
    controllerWallet: manifest.agent.controllerWallet,
    actionType: manifest.action.txType,
    network: manifest.action.network,
    relyingPartyName: manifest.relyingParty.name,
    relyingPartyType: manifest.relyingParty.type,
    acceptanceBoundary: manifest.relyingParty.acceptanceBoundary,
    publicAcceptanceRule: manifest.relyingParty.publicAcceptanceRule
  };
}

function validateAuthorizationHandoff({ manifest, actionRecordId, authorizationResult }) {
  const {
    resultHash: claimedResultHash,
    ...unsignedAuthorizationResult
  } = authorizationResult && typeof authorizationResult === "object"
    ? authorizationResult
    : {};
  const resultHashValid = typeof claimedResultHash === "string" &&
    hashObject(unsignedAuthorizationResult) === claimedResultHash;
  const matches = authorizationResult?.version === REFERENCE_WORKFLOW_AUTHORIZATION_RESULT_VERSION &&
    authorizationResult?.ok === true &&
    authorizationResult?.status === "authorized" &&
    authorizationResult?.authorizedAction?.authorized === true &&
    authorizationResult?.authorizedAction?.recordId === actionRecordId &&
    authorizationResult?.workflow?.workflowId === manifest.workflowId &&
    authorizationResult?.workflow?.botId === manifest.agent.botId &&
    authorizationResult?.workflow?.controllerWallet === manifest.agent.controllerWallet &&
    authorizationResult?.workflow?.actionType === manifest.action.txType &&
    authorizationResult?.workflow?.network === manifest.action.network &&
    authorizationResult?.officialRegistry?.asset === manifest.agent.officialRegistry.asset &&
    authorizationResult?.officialRegistry?.programId === manifest.agent.officialRegistry.programId &&
    authorizationResult?.rejectionProbe?.rejected === true &&
    typeof authorizationResult?.authorizedAction?.serializedTransactionHash === "string" &&
    resultHashValid;

  if (!matches) {
    const error = new Error("A matching pre-execution authorization result is required before post-execution verification.");
    error.name = "SvsReferenceWorkflowAuthorizationHandoffError";
    throw error;
  }
}

function sanitizeRejection(error) {
  return {
    rejected: true,
    errorName: error?.name ?? "Error",
    status: error?.details?.status ?? null,
    failureCode: error?.details?.nextAction?.code ?? "rejected",
    failedCheck: error?.details?.firstFailure?.name ?? null
  };
}

function createMismatchedSerializedTransaction(serializedTransaction) {
  const normalized = typeof serializedTransaction === "string"
    ? serializedTransaction.trim()
    : "";
  const bytes = Buffer.from(normalized, "base64");
  const canonical = bytes.toString("base64").replace(/=+$/, "");

  if (!normalized || bytes.length === 0 || canonical !== normalized.replace(/=+$/, "")) {
    throw new Error("serializedTransaction must be valid base64 for the mismatch probe.");
  }

  const mismatched = Buffer.from(bytes);
  mismatched[mismatched.length - 1] ^= 0x01;
  return mismatched.toString("base64");
}

function findSecretFields(value, path, issues) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY_PATTERN.test(key)) {
      issues.push({ path: nestedPath, code: "secret_field_forbidden", message: "Reference workflow manifests must not contain credentials or private keys." });
    }
    findSecretFields(nested, nestedPath, issues);
  }
}

function hashObject(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
