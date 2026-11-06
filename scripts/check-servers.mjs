// For each app a pull request adds or changes, read what its server says
// publicly about signing in, and lay that out for the person who merges. It
// registers nothing: that waits until the file is on main.
// Usage: node check-servers.mjs --root <this change> --base <main>

import { appendFileSync } from "node:fs";
import { argument, discover, listApps, plain } from "./lib.mjs";

const before = new Map(
  listApps(argument("--base", ".main")).map((entry) => [entry.fileName, entry])
);
const changed = listApps(argument("--root", ".")).filter(
  (entry) => entry.app && before.get(entry.fileName)?.text !== entry.text
);

const rows = [];
let failed = false;

for (const { fileName, app } of changed) {
  const server = app.connect?.server;
  const addressMoved = before.get(fileName)?.app?.connect?.server !== server;
  const found = await discover(server);
  if (!found.ok) {
    failed = true;
    console.log(`::error file=apps/${fileName}::${plain(found.reason)}`);
    rows.push(`| ${plain(app.name)} | ${new URL(server).hostname} | ${addressMoved ? "yes" : "no"} | ${plain(found.reason)} |`);
    continue;
  }
  if (!found.registers) {
    failed = true;
    console.log(
      `::error file=apps/${fileName}::This server needs an app registered by Tutti, so it can't be added from a file alone. Ask for it in an issue instead.`
    );
  }
  rows.push(
    `| ${plain(app.name)} | ${new URL(server).hostname} | ${addressMoved ? "yes" : "no"} | Signs in at ${plain(found.signInHost)}. ${found.registers ? "Apps register themselves." : "Needs a registered app."} ${found.renews === false ? "Gives no way to renew." : ""} |`
  );
}

const summary = changed.length
  ? `### For the person who merges\n\nIs each address really that company's own?\n\n| App | Server | New or moved address | What it says |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`
  : "No app files changed.\n";

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
process.exit(failed ? 1 : 0);
