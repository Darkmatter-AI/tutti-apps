// The last step of the night. It writes status.json, which a watcher outside
// GitHub reads every day, so a night that went wrong and a night that never ran
// both get noticed.
// Usage: node finish.mjs --proof <checkout of the proof branch>

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argument, listApps, plain, readProof, stateOf, today } from "./lib.mjs";

const proofDir = argument("--proof", ".proof");

function takeNote(name) {
  const path = join(proofDir, `run-${name}.json`);
  try {
    const note = JSON.parse(readFileSync(path, "utf8"));
    rmSync(path);
    return note;
  } catch {
    return undefined;
  }
}

const nightly = takeNote("nightly");
const review = takeNote("review");
const draft = takeNote("draft");

const steps = {
  check: process.env.STEP_CHECK ?? "unknown",
  review: process.env.STEP_REVIEW ?? "unknown",
  draft: process.env.STEP_DRAFT ?? "unknown",
};

// One file for everything that reads this repo, so nobody works out an app's
// state a second way
const counts = {};
const catalog = [];
for (const { errors, app } of listApps(".")) {
  if (errors.length > 0) {
    continue;
  }
  const proof = readProof(proofDir, app.key);
  const state = stateOf(proof);
  counts[state] = (counts[state] ?? 0) + 1;
  catalog.push({
    ...app,
    state,
    firstSignIn: proof.firstSignIn ?? null,
    tools: proof.tools ?? null,
    lastChecked: proof.lastChecked ?? null,
    signInHost: proof.signInHost ?? null,
    renews: proof.renews ?? null,
  });
}
writeFileSync(
  join(proofDir, "catalog.json"),
  `${JSON.stringify({ date: today(), apps: catalog }, null, 2)}\n`
);

const sentences = [];
for (const { name, problem } of nightly?.newlyFailing ?? []) {
  sentences.push(`${plain(name, 40)} has failed two nights running: ${plain(problem)}`);
}
for (const { name } of nightly?.newlyChanged ?? []) {
  sentences.push(`${plain(name, 40)}'s sign-in server changed, so it needs a look before it's listed again.`);
}
for (const { name, problem } of nightly?.signInProblems ?? []) {
  sentences.push(`${plain(name, 40)}'s sign-in page didn't open for Tutti: ${plain(problem)}`);
}
for (const { name, problem } of review?.newlyDoubted ?? []) {
  sentences.push(`The second agent doubts ${plain(name, 40)}: ${plain(problem)}`);
}
for (const [step, outcome] of Object.entries(steps)) {
  if (outcome === "failure") {
    sentences.push(`The ${step} step failed.`);
  }
}

const run = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

const status = {
  date: today(),
  run,
  counts,
  steps,
  drafts: draft?.outcomes ?? [],
  queued: draft?.queued ?? null,
  alert: sentences.length > 0 ? sentences.join(" ") : null,
};

writeFileSync(join(proofDir, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
console.log(JSON.stringify(status, null, 2));
process.exit(Object.values(steps).includes("failure") ? 1 : 0);
