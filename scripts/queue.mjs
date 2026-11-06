// Which app the drafting agent looks at next. Pure, so it can be tested without
// a network. From a public issue it takes only the name in the form's one field.

import { daysSince } from "./lib.mjs";

const ASKED_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .&+'-]{0,39}$/u;
const LOOK_AGAIN_DAYS = 30;

/** The app name in an issue the form wrote, or undefined for anything else. */
export function nameFromIssue(body) {
  const match = /^### App name\s*\n+([^\n]+)/m.exec(String(body ?? ""));
  const name = match?.[1]?.trim();
  return name && ASKED_NAME.test(name) ? name : undefined;
}

export const keyFromName = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Most asked for first, then the list we keep ourselves. Apps already here and
 * apps looked at in the last 30 days are left out.
 */
export function buildQueue({ issues, wanted, existingKeys, looked, now = new Date() }) {
  const asked = new Map();
  for (const issue of issues) {
    const name = nameFromIssue(issue.body);
    if (!name) {
      continue;
    }
    const key = keyFromName(name);
    const entry = asked.get(key) ?? { key, name, votes: 0, issues: [] };
    entry.votes += 1 + (issue.reactions?.["+1"] ?? 0);
    entry.issues.push(issue.number);
    asked.set(key, entry);
  }
  const fromPeople = [...asked.values()].sort((a, b) => b.votes - a.votes);
  const fromList = wanted
    .map((name) => ({ key: keyFromName(name), name, votes: 0, issues: [] }))
    .filter((entry) => !asked.has(entry.key));

  const lookedRecently = (key) =>
    looked[key] && daysSince(looked[key].date, now) < LOOK_AGAIN_DAYS;

  return [...fromPeople, ...fromList].filter(
    (entry) => entry.key && !existingKeys.has(entry.key) && !lookedRecently(entry.key)
  );
}
