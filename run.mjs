#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import {
  requireAcceptedAction,
  requireAuthorizedAction
} from "@svsprotocol/solana/protocol";
import { SolanaSDK } from "8004-solana";
import {
  createCaseStudyMarkdown,
  runReferenceAuthorization,
  runReferenceWorkflow,
  validateReferenceWorkflowManifest
} from "./lib/reference-workflow.mjs";

const args = parseArgs(process.argv.slice(2));
const manifestPath = resolve(String(args.manifest ?? "./workflow.manifest.json"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (args.check === true) {
  const validation = validateReferenceWorkflowManifest(manifest, {
    allowPlaceholders: args["allow-placeholders"] === true
  });
  console.log(JSON.stringify(validation, null, 2));
  process.exit(validation.ok ? 0 : 1);
}

await loadEnvFile(resolve(String(args.env ?? ".env")));
const validation = validateReferenceWorkflowManifest(manifest);
if (!validation.ok) {
  console.error(JSON.stringify(validation, null, 2));
  process.exit(1);
}

const requiredEnv = ["SVS_SERVER_URL", "SVS_PROTOCOL_API_KEY", "SVS_PROTOCOL_REQUEST_SIGNING_SECRET", "SVS_ACTION_RECORD_ID"];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required environment value(s): ${missing.join(", ")}.`);

const registryClient = new SolanaSDK({ cluster: manifest.agent.officialRegistry.network });
const phase = String(args.phase ?? "verify");
const outputDir = resolve(String(args.output ?? "./output"));
await mkdir(outputDir, { recursive: true });
const agentRegistryIdentity = {
  agentRegistryClient: registryClient,
  agentAsset: new PublicKey(manifest.agent.officialRegistry.asset),
  expectedNetwork: manifest.agent.officialRegistry.network,
  expectedProgramId: manifest.agent.officialRegistry.programId
};

if (phase === "authorize") {
  if (!process.env.SVS_SERIALIZED_TRANSACTION_BASE64) {
    throw new Error("Missing required environment value: SVS_SERIALIZED_TRANSACTION_BASE64.");
  }
  const result = await runReferenceAuthorization({
    manifest,
    actionRecordId: process.env.SVS_ACTION_RECORD_ID,
    serializedTransaction: process.env.SVS_SERIALIZED_TRANSACTION_BASE64,
    requireAuthorizedAction: (options) => requireAuthorizedAction({
      ...options,
      baseUrl: process.env.SVS_SERVER_URL,
      apiKey: process.env.SVS_PROTOCOL_API_KEY,
      requestSigningSecret: process.env.SVS_PROTOCOL_REQUEST_SIGNING_SECRET
    }),
    agentRegistryIdentity
  });
  const authorizationPath = resolve(outputDir, "authorization-result.json");
  await writeFile(authorizationPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    status: result.status,
    resultHash: result.resultHash,
    authorizationResult: authorizationPath
  }, null, 2));
  process.exit(0);
}

if (phase !== "verify") throw new Error(`Unsupported workflow phase: ${phase}.`);
const authorizationPath = resolve(outputDir, "authorization-result.json");
const authorizationResult = JSON.parse(await readFile(authorizationPath, "utf8"));
const result = await runReferenceWorkflow({
  manifest,
  actionRecordId: process.env.SVS_ACTION_RECORD_ID,
  authorizationResult,
  requireAcceptedAction: (options) => requireAcceptedAction({
    ...options,
    baseUrl: process.env.SVS_SERVER_URL,
    apiKey: process.env.SVS_PROTOCOL_API_KEY,
    requestSigningSecret: process.env.SVS_PROTOCOL_REQUEST_SIGNING_SECRET
  }),
  agentRegistryIdentity
});

await writeFile(resolve(outputDir, "verification-result.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(resolve(outputDir, "case-study.md"), createCaseStudyMarkdown(result));
console.log(JSON.stringify({
  ok: true,
  status: result.status,
  resultHash: result.resultHash,
  verificationResult: resolve(outputDir, "verification-result.json"),
  caseStudy: resolve(outputDir, "case-study.md"),
  publishable: result.publication.publishable
}, null, 2));

async function loadEnvFile(path) {
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return parsed;
}
