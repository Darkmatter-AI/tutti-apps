// Once a night, read every app's server and write what it found to the proof
// branch. The first time an app's server reads well, also open its sign-in page
// once, which registers a client named Tutti at that company and grants nothing.
// Usage: node nightly.mjs --proof <checkout of the proof branch>

import {
  argument,
  daysSince,
  discover,
  listApps,
  noteRun,
  openSignInPage,
  plain,
  pool,
  readProof,
  today,
  writeProof,
} from "./lib.mjs";

const SIGN_IN_RETRY_DAYS = 7;
const FAILING_AFTER_NIGHTS = 2;

const proofDir = argument("--proof", ".proof");
// Someone with write access has looked at this app and is happy with it
const accepted = /^[a-z0-9-]+$/.test(process.env.ACCEPT ?? "") ? process.env.ACCEPT : undefined;
const date = today();

const apps = listApps(".")
  .filter((entry) => entry.errors.length === 0)
  .map((entry) => entry.app);

const newlyFailing = [];
const newlyChanged = [];
const signInProblems = [];

await pool(apps, 4, async (app) => {
  const proof = readProof(proofDir, app.key);

  if (accepted === app.key) {
    proof.metadataHash = undefined;
    proof.changedOn = undefined;
    if (proof.review?.verdict === "doubt") {
      proof.review = { ...proof.review, verdict: "pass", acceptedOn: date };
    }
  }

  const found = await discover(app.connect.server);

  if (!found.ok) {
    proof.failures = (proof.failures ?? 0) + 1;
    proof.problem = plain(found.reason);
    if (proof.failures === FAILING_AFTER_NIGHTS) {
      newlyFailing.push({ key: app.key, name: app.name, problem: proof.problem });
    }
    writeProof(proofDir, proof);
    return;
  }

  proof.failures = 0;
  proof.problem = undefined;
  proof.lastChecked = date;
  proof.signInHost = plain(found.signInHost, 100);
  proof.registers = found.registers;
  proof.renews = found.renews;

  if (!proof.metadataHash) {
    proof.metadataHash = found.hash;
  } else if (proof.metadataHash !== found.hash && !proof.changedOn) {
    proof.changedOn = date;
    newlyChanged.push({ key: app.key, name: app.name });
  }

  const dueForSignIn =
    !proof.signInPage &&
    found.registers &&
    (!proof.signInTried || daysSince(proof.signInTried) >= SIGN_IN_RETRY_DAYS);
  if (dueForSignIn) {
    proof.signInTried = date;
    const page = await openSignInPage(found);
    if (page.ok) {
      proof.signInPage = date;
      proof.signInProblem = undefined;
    } else {
      proof.signInProblem = plain(page.reason);
      signInProblems.push({ key: app.key, name: app.name, problem: proof.signInProblem });
    }
  }

  writeProof(proofDir, proof);
});

noteRun(proofDir, "nightly", { newlyFailing, newlyChanged, signInProblems });
console.log(
  `${apps.length} servers read. ${newlyFailing.length} newly failing, ${newlyChanged.length} changed, ${signInProblems.length} sign-in pages didn't open.`
);
