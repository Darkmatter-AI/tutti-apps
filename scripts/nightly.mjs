// Once a night, read every app's server and write what it found to the proof
// branch. The first time an app's server reads well, also open its sign-in page
// once, which registers a client named Tutti at that company and grants nothing.
// It also asks Tutti which apps someone has really connected, which is the only
// way onto the public list.
// Usage: node nightly.mjs --proof <checkout of the proof branch>

import {
  argument,
  daysSince,
  discover,
  listApps,
  noteFirstSignIn,
  noteRun,
  openSignInPage,
  plain,
  pool,
  proofFor,
  readFirstSignIns,
  today,
  writeProof,
} from "./lib.mjs";

const SIGN_IN_RETRY_DAYS = 7;
const FIRST_SIGN_INS = "https://tuttiwork.com/api/apps/first-sign-ins";
const FIRST_SIGN_INS_TIMEOUT_MS = 20_000;

const proofDir = argument("--proof", ".proof");
// Someone with write access has looked at this app and is happy with it
const accepted = /^[a-z0-9-]+$/.test(process.env.ACCEPT ?? "") ? process.env.ACCEPT : undefined;
const date = today();

const apps = listApps(".")
  .filter((entry) => entry.errors.length === 0)
  .map((entry) => entry.app);

const signInProblems = [];
const nowListed = [];

/** Tutti not answering costs a night's wait and stops nothing else. */
async function firstSignIns() {
  try {
    const response = await fetch(FIRST_SIGN_INS, {
      signal: AbortSignal.timeout(FIRST_SIGN_INS_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { found: new Map(), problem: `Tutti answered ${response.status}.` };
    }
    return { found: readFirstSignIns(await response.json()) };
  } catch {
    return { found: new Map(), problem: "Tutti gave no answer that could be read." };
  }
}

const { found: connected, problem: firstSignInsProblem } = await firstSignIns();

/** One server's bad answer never stops the others being read. */
async function reading(job) {
  try {
    return await job();
  } catch {
    return { ok: false, reason: "Its answer couldn't be read." };
  }
}

await pool(apps, 4, async (app) => {
  const proof = proofFor(proofDir, app);

  if (accepted === app.key) {
    proof.metadataHash = undefined;
    proof.changedOn = undefined;
    if (proof.review?.verdict === "doubt") {
      proof.review = { ...proof.review, verdict: "pass", acceptedOn: date };
    }
  }

  if (noteFirstSignIn(proof, connected.get(app.key))) {
    nowListed.push(app.name);
  }

  const found = await reading(() => discover(app.connect.server));

  if (!found.ok) {
    // Counted by the night, so running this twice in a day doesn't make it two
    if (proof.failedOn !== date) {
      proof.failures = (proof.failures ?? 0) + 1;
      proof.failedOn = date;
    }
    proof.problem = plain(found.reason);
    writeProof(proofDir, proof);
    return;
  }

  proof.failures = 0;
  proof.failedOn = undefined;
  proof.problem = undefined;
  proof.lastChecked = date;
  proof.signInHost = plain(found.signInHost, 100);
  proof.registers = found.registers;
  proof.renews = found.renews;

  if (!proof.metadataHash) {
    proof.metadataHash = found.hash;
  } else if (proof.metadataHash !== found.hash && !proof.changedOn) {
    proof.changedOn = date;
  }

  const dueForSignIn =
    !proof.signInPage &&
    found.registers &&
    (!proof.signInTried || daysSince(proof.signInTried) >= SIGN_IN_RETRY_DAYS);
  if (dueForSignIn) {
    proof.signInTried = date;
    const page = await reading(() => openSignInPage(found));
    if (page.ok) {
      proof.signInPage = date;
      proof.signInProblem = undefined;
    } else {
      const problem = plain(page.reason);
      // Retried each week, and only news is worth saying
      if (proof.signInProblem !== problem) {
        signInProblems.push({ key: app.key, name: app.name, problem });
      }
      proof.signInProblem = problem;
    }
  }

  writeProof(proofDir, proof);
});

noteRun(proofDir, "nightly", { signInProblems, nowListed, firstSignInsProblem });
console.log(`${apps.length} servers read. ${signInProblems.length} sign-in pages didn't open.`);
