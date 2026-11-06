// Reads every app file as data. It needs no network and no secrets.
// Usage: node check-files.mjs --root <folder holding apps/>

import { argument, crossFileErrors, listApps } from "./lib.mjs";

const apps = listApps(argument("--root", "."));
let failed = false;

for (const { fileName, errors } of apps) {
  for (const error of errors) {
    failed = true;
    console.log(`::error file=apps/${fileName}::${error}`);
  }
}
for (const error of crossFileErrors(apps)) {
  failed = true;
  console.log(`::error::${error}`);
}

console.log(`${apps.length} app files read.`);
process.exit(failed ? 1 : 0);
