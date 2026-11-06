// Shared by the checks and the agents. It has no dependencies, so nothing here
// can arrive through an install.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const USER_AGENT =
  "tutti-apps-check (+https://github.com/Darkmatter-AI/tutti-apps)";

/** Where a company's sign-in page sends someone back to: Tutti's real address. */
export const REDIRECT_URI = "https://tuttiwork.com/api/connectors/mcp/callback";

const TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 1_000_000;

export const CATEGORIES = [
  "projects",
  "mail-and-calendar",
  "chat",
  "docs",
  "code",
  "design",
  "analytics",
  "support",
  "forms-and-booking",
  "payments",
  "ai-models",
  "web-data",
  "social",
  "media",
  "websites",
  // Found by search only, with no category row of its own
  "other",
];

const APP_FIELDS = ["key", "name", "category", "blurb", "company", "connect"];
const CONNECT_FIELDS = ["kind", "server"];
const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// The last part must start with a letter, which also rules out a bare IP address
const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]([a-z0-9-]*[a-z0-9])?$/;
const PRIVATE_NAME = /(^|\.)(internal|intranet|lan|local|localhost|test)$/;
// No slashes, colons, brackets or at signs, so a name can't be a link, a mention
// or markup wherever it ends up
const WORDS = /^[\p{L}\p{N}][\p{L}\p{N} .,&+'-]*$/u;

// Anyone can rent a name on these, so being on one says nothing about who runs it
const RENTED_HOSTS = [
  "amazonaws.com",
  "azurewebsites.net",
  "cloudfront.net",
  "deno.dev",
  "firebaseapp.com",
  "fly.dev",
  "github.io",
  "githubusercontent.com",
  "glitch.me",
  "herokuapp.com",
  "loca.lt",
  "modal.run",
  "netlify.app",
  "ngrok-free.app",
  "ngrok-free.dev",
  "ngrok.app",
  "ngrok.io",
  "nip.io",
  "onrender.com",
  "pages.dev",
  "railway.app",
  "replit.app",
  "run.app",
  "serveo.net",
  "sslip.io",
  "trycloudflare.com",
  "vercel.app",
  "web.app",
  "workers.dev",
];

// A country's own ending, like co.uk, which nobody can run a company on
const COUNTRY_ENDING = /^(ac|co|com|edu|gov|ne|net|or|org)\.[a-z]{2}$/;

// A server's address naming another client was made for that client
const OTHER_CLIENT = /(^|[/_-])(anthropic|chatgpt|claude|copilot|cursor|openai)([/_-]|$)/i;

export function isUnder(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** A name on the public internet, so never an IP address or a private network's name. */
export function isPublicName(host) {
  return DOMAIN.test(host) && !PRIVATE_NAME.test(host);
}

function serverErrors(server, company) {
  if (typeof server !== "string") {
    return ["connect.server must be an address."];
  }
  let url;
  try {
    url = new URL(server);
  } catch {
    return ["connect.server isn't a valid address."];
  }
  const errors = [];
  if (url.protocol !== "https:") {
    errors.push("connect.server must use https.");
  }
  if (url.username || url.password) {
    errors.push("connect.server can't hold a name or a password.");
  }
  if (url.port) {
    errors.push("connect.server can't name a port.");
  }
  if (url.search || url.hash) {
    errors.push("connect.server can't hold a query or a fragment.");
  }
  if (typeof company === "string" && !isUnder(url.hostname, company)) {
    errors.push("connect.server must be on the company's own domain.");
  }
  if (OTHER_CLIENT.test(url.pathname)) {
    errors.push("connect.server names another client, so it was made for them.");
  }
  return errors;
}

/** Everything wrong with one app file, in words someone can act on. */
export function validateApp(fileName, app) {
  if (app === null || typeof app !== "object" || Array.isArray(app)) {
    return ["The file must hold one JSON object."];
  }
  const errors = [];
  for (const field of Object.keys(app)) {
    if (!APP_FIELDS.includes(field)) {
      errors.push(`Unknown field: ${plain(field, 40)}.`);
    }
  }
  if (typeof app.key !== "string" || !KEY.test(app.key)) {
    errors.push("key must be lower-case letters and numbers, with single hyphens.");
  } else if (fileName !== `${app.key}.json`) {
    errors.push(`The file must be called ${app.key}.json.`);
  }
  if (typeof app.name !== "string" || app.name.length > 40 || !WORDS.test(app.name)) {
    errors.push("name must be plain words, 40 characters at most.");
  }
  if (!CATEGORIES.includes(app.category)) {
    errors.push(`category must be one of: ${CATEGORIES.join(", ")}.`);
  }
  if (typeof app.blurb !== "string" || app.blurb.length > 60 || !WORDS.test(app.blurb)) {
    errors.push("blurb must be plain words, 60 characters at most.");
  }
  if (typeof app.company !== "string" || !isPublicName(app.company)) {
    errors.push("company must be the domain of the company that runs the server.");
  } else if (
    COUNTRY_ENDING.test(app.company) ||
    RENTED_HOSTS.some((host) => isUnder(app.company, host))
  ) {
    errors.push("company can't be a domain anyone can rent a name on.");
  }
  const connect = app.connect;
  if (connect === null || typeof connect !== "object" || Array.isArray(connect)) {
    errors.push("connect must say how the app connects.");
    return errors;
  }
  for (const field of Object.keys(connect)) {
    if (!CONNECT_FIELDS.includes(field)) {
      errors.push(`Unknown field: connect.${plain(field, 40)}.`);
    }
  }
  if (connect.kind !== "mcp") {
    errors.push('connect.kind must be "mcp".');
  }
  errors.push(...serverErrors(connect.server, app.company));
  return errors;
}

/**
 * The one way an app file is written. A person reads the text and the parser
 * reads the value, so a repeated field or an escape could show them different
 * addresses. This way they can't differ.
 */
export const writtenForm = (app) => `${JSON.stringify(app, null, 2)}\n`;

/** Every app file under a folder, whether it reads or not. */
export function listApps(root) {
  const folder = join(root, "apps");
  return readdirSync(folder, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((entry) => {
      // These names come from strangers, and the checks print them
      const fileName = plain(entry.name, 80);
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        return { fileName, errors: ["Only .json files belong in apps."] };
      }
      const text = readFileSync(join(folder, entry.name), "utf8");
      let app;
      try {
        app = JSON.parse(text);
      } catch {
        return { fileName, text, errors: ["The file isn't valid JSON."] };
      }
      const errors = validateApp(entry.name, app);
      if (text !== writtenForm(app)) {
        errors.push(
          "Write the file with two spaces, one field to a line, no repeated fields and no escapes."
        );
      }
      return { fileName, text, app, errors };
    });
}

/** Mistakes only visible across files. */
export function crossFileErrors(apps) {
  const errors = [];
  const servers = new Map();
  const names = new Map();
  for (const { fileName, app } of apps) {
    const server = app?.connect?.server;
    if (typeof server === "string") {
      if (servers.has(server)) {
        errors.push(`${fileName} and ${servers.get(server)} name the same server.`);
      }
      servers.set(server, fileName);
    }
    const name = typeof app?.name === "string" ? app.name.toLowerCase() : undefined;
    if (name) {
      if (names.has(name)) {
        errors.push(`${fileName} and ${names.get(name)} have the same name.`);
      }
      names.set(name, fileName);
    }
  }
  return errors;
}

/** Text from a server or a model, cut down to words so it can't be a link or a mention. */
export function plain(text, maxLength = 200) {
  return String(text ?? "")
    .replace(/[^\p{L}\p{N} .,'()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

const timeout = () => AbortSignal.timeout(TIMEOUT_MS);

/**
 * `unavailable` means the answer says nothing about how the server is set up: it
 * was down or busy. Treating that as "not there" would look like a server whose
 * sign-in moved.
 */
async function readJson(url, fetchFn) {
  let text;
  try {
    const response = await fetchFn(url, {
      headers: {
        accept: "application/json",
        "mcp-protocol-version": "2025-06-18",
        "user-agent": USER_AGENT,
      },
      signal: timeout(),
    });
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      return { unavailable: true };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return {};
    }
    text = await response.text();
  } catch {
    return { unavailable: true };
  }
  if (text.length > MAX_BODY_CHARS) {
    return {};
  }
  try {
    const json = JSON.parse(text);
    return json !== null && typeof json === "object" ? { json } : {};
  } catch {
    return {};
  }
}

async function firstJson(urls, fetchFn) {
  for (const url of urls) {
    const result = await readJson(url, fetchFn);
    if (result.json || result.unavailable) {
      return result;
    }
  }
  return {};
}

const stringsIn = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

/** An address from a server's own words that people's sign-ins can safely go to. */
function isSafeAddress(address) {
  if (typeof address !== "string") {
    return false;
  }
  try {
    const url = new URL(address);
    return (
      url.protocol === "https:" && !url.username && !url.password && isPublicName(url.hostname)
    );
  } catch {
    return false;
  }
}

const withoutSlash = (path) => path.replace(/\/+$/, "");

function resourceAddresses(serverUrl) {
  const path = withoutSlash(serverUrl.pathname);
  const root = `${serverUrl.origin}/.well-known/oauth-protected-resource`;
  return path ? [`${root}${path}`, root] : [root];
}

function signInAddresses(authorizationServer) {
  const { origin, pathname } = authorizationServer;
  const path = withoutSlash(pathname);
  if (!path) {
    return [
      `${origin}/.well-known/oauth-authorization-server`,
      `${origin}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}/.well-known/openid-configuration${path}`,
    `${origin}${path}/.well-known/openid-configuration`,
  ];
}

function namesThisServer(resource, serverUrl) {
  try {
    const named = new URL(resource);
    const namedPath = `${withoutSlash(named.pathname)}/`;
    const serverPath = `${withoutSlash(serverUrl.pathname)}/`;
    return named.origin === serverUrl.origin && serverPath.startsWith(namedPath);
  } catch {
    return false;
  }
}

function isSameAddress(address, url) {
  try {
    return withoutSlash(new URL(address).href) === withoutSlash(url.href);
  } catch {
    return false;
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest();

const UNAVAILABLE = "Its sign-in details didn't load just now.";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "tutti-apps-check", version: "1" },
  },
};

/**
 * Read what a server says publicly about signing in. It holds no token, so it
 * sees nobody's data, and it registers nothing. Tutti finds the same things the
 * same way when someone connects.
 */
export async function discover(serverAddress, fetchFn = fetch) {
  const failed = (reason) => ({ ok: false, reason });
  const serverUrl = new URL(serverAddress);
  if (serverUrl.protocol !== "https:" || !isPublicName(serverUrl.hostname)) {
    return failed("The server's address must be https on a public name.");
  }

  let status;
  try {
    const response = await fetchFn(serverAddress, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify(INITIALIZE),
      redirect: "manual",
      signal: timeout(),
    });
    status = response.status;
    await response.body?.cancel();
  } catch (error) {
    return failed(`The server didn't answer (${plain(error?.cause?.code ?? error?.name, 40)}).`);
  }
  if (status >= 200 && status < 300) {
    return failed("It answers with no sign-in, so there is nothing to connect to.");
  }
  if (status !== 401 && status !== 403) {
    return failed(`It answered ${status} rather than asking for a sign-in.`);
  }

  const resource = await firstJson(resourceAddresses(serverUrl), fetchFn);
  if (resource.unavailable) {
    return failed(UNAVAILABLE);
  }
  const resourceMetadata = resource.json;
  if (resourceMetadata && !namesThisServer(resourceMetadata.resource, serverUrl)) {
    return failed("It names a resource other than itself.");
  }

  let authorizationServer;
  try {
    authorizationServer = new URL(
      stringsIn(resourceMetadata?.authorization_servers)[0] ?? "/",
      serverAddress
    );
  } catch {
    return failed("It names a sign-in server that isn't a valid address.");
  }
  if (authorizationServer.protocol !== "https:" || !isPublicName(authorizationServer.hostname)) {
    return failed("Its sign-in server must be https on a public name.");
  }

  const signIn = await firstJson(signInAddresses(authorizationServer), fetchFn);
  if (signIn.unavailable) {
    return failed(UNAVAILABLE);
  }
  const metadata = signIn.json;
  if (!metadata?.authorization_endpoint || !metadata?.token_endpoint) {
    return failed("It doesn't say where to sign in.");
  }
  if (metadata.issuer !== undefined && !isSameAddress(metadata.issuer, authorizationServer)) {
    return failed("Its sign-in server gives another server's name as its own.");
  }
  const endpoints = [metadata.authorization_endpoint, metadata.token_endpoint];
  if (metadata.registration_endpoint) {
    endpoints.push(metadata.registration_endpoint);
  }
  if (!endpoints.every(isSafeAddress)) {
    return failed("Its sign-in addresses must be https on a public name.");
  }
  const challenges = metadata.code_challenge_methods_supported;
  if (Array.isArray(challenges) && !challenges.includes("S256")) {
    return failed("Its sign-in server doesn't support S256.");
  }

  const scopes = new Set(stringsIn(resourceMetadata?.scopes_supported));
  if (stringsIn(metadata.scopes_supported).includes("offline_access")) {
    scopes.add("offline_access");
  }
  const grants = metadata.grant_types_supported;
  const signature = JSON.stringify([
    resourceMetadata?.resource ?? null,
    authorizationServer.href,
    metadata.issuer ?? null,
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.registration_endpoint ?? null,
  ]);

  return {
    ok: true,
    status,
    signInHost: new URL(metadata.authorization_endpoint).hostname,
    registers: Boolean(metadata.registration_endpoint),
    renews: Array.isArray(grants) ? grants.includes("refresh_token") : null,
    hash: `sha256:${sha256(signature).toString("hex")}`,
    metadata,
    scope: scopes.size > 0 ? [...scopes].join(" ") : undefined,
    resource: resourceMetadata?.resource,
  };
}

const NOT_ACCEPTED =
  /invalid[_ ](request|redirect|client|scope)|redirect[_ ]?ur[il].{0,40}(mismatch|invalid|not allowed|not registered)|unauthorized_client/i;
const BOT_CHECK = /just a moment|challenge-platform|cf-chl|captcha/i;
const MAX_REDIRECTS = 4;

// What the page says, not what its scripts might show in some other state
const withoutScripts = (html) =>
  html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ");

const ONLY_ITS_OWN_LIST =
  "It only lets in return addresses on its own list, so the company needs to add Tutti's.";
const BEHIND_A_BOT_CHECK = "A bot check stands in front of its sign-in page, so this can't tell.";

/**
 * Register a client named Tutti at the company and load its sign-in page, the
 * way Tutti does when someone connects. This grants nothing: nobody approves
 * anything, and the client's id and secret are thrown away unread by any log.
 */
export async function openSignInPage(found, fetchFn = fetch) {
  const { metadata } = found;
  const secretAllowed = stringsIn(metadata.token_endpoint_auth_methods_supported).includes(
    "client_secret_post"
  );

  let client;
  try {
    const registered = await fetchFn(metadata.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({
        client_name: "Tutti",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: secretAllowed ? "client_secret_post" : "none",
      }),
      redirect: "error",
      signal: timeout(),
    });
    if (!registered.ok) {
      const words = (await registered.text()).slice(0, 2000);
      return {
        ok: false,
        reason: /redirect/i.test(words)
          ? ONLY_ITS_OWN_LIST
          : `Registering answered ${registered.status}.`,
      };
    }
    client = await registered.json();
  } catch (error) {
    return { ok: false, reason: `Registering failed (${plain(error?.name, 40)}).` };
  }
  if (!client?.client_id) {
    return { ok: false, reason: "Registering gave no client." };
  }

  const verifier = randomBytes(32).toString("base64url");
  const signInUrl = new URL(metadata.authorization_endpoint);
  signInUrl.searchParams.set("response_type", "code");
  signInUrl.searchParams.set("client_id", client.client_id);
  signInUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  signInUrl.searchParams.set("code_challenge", sha256(verifier).toString("base64url"));
  signInUrl.searchParams.set("code_challenge_method", "S256");
  signInUrl.searchParams.set("state", randomBytes(16).toString("hex"));
  if (found.scope) {
    signInUrl.searchParams.set("scope", found.scope);
  }
  if (found.resource) {
    signInUrl.searchParams.set("resource", found.resource);
  }

  try {
    let address = signInUrl;
    for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
      const page = await fetchFn(address, {
        headers: { accept: "text/html", "user-agent": USER_AGENT },
        redirect: "manual",
        signal: timeout(),
      });
      if (page.status >= 300 && page.status < 400) {
        await page.body?.cancel();
        const next = new URL(page.headers.get("location") ?? "", address);
        if (next.href.startsWith(REDIRECT_URI) || next.searchParams.has("error")) {
          return {
            ok: false,
            reason: NOT_ACCEPTED.test(next.search)
              ? ONLY_ITS_OWN_LIST
              : "The sign-in page sent Tutti straight back with an error.",
          };
        }
        if (!isSafeAddress(next.href)) {
          return { ok: false, reason: "The sign-in page sent Tutti to an unsafe address." };
        }
        address = next;
        continue;
      }
      const body = (await page.text()).slice(0, MAX_BODY_CHARS);
      if (NOT_ACCEPTED.test(withoutScripts(body))) {
        return { ok: false, reason: ONLY_ITS_OWN_LIST };
      }
      if (page.status === 200) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: BOT_CHECK.test(body) ? BEHIND_A_BOT_CHECK : `The sign-in page answered ${page.status}.`,
      };
    }
    return { ok: false, reason: "The sign-in page kept sending Tutti elsewhere." };
  } catch (error) {
    return { ok: false, reason: `The sign-in page failed (${plain(error?.name, 40)}).` };
  }
}

const proofPath = (proofDir, key) => join(proofDir, "proof", `${key}.json`);

export function readProof(proofDir, key) {
  try {
    return JSON.parse(readFileSync(proofPath(proofDir, key), "utf8"));
  } catch {
    return { key, firstSignIn: null, tools: null, toolsHash: null, lastChecked: null };
  }
}

/**
 * An app's proof, which only holds for the address it was earned on. If the
 * address moved, everything about it starts again.
 */
export function proofFor(proofDir, app) {
  const proof = readProof(proofDir, app.key);
  const { server } = app.connect;
  if (proof.server && proof.server !== server) {
    return { key: app.key, server, firstSignIn: null, tools: null, toolsHash: null, lastChecked: null };
  }
  return { ...proof, server };
}

export function writeProof(proofDir, proof) {
  mkdirSync(join(proofDir, "proof"), { recursive: true });
  writeFileSync(proofPath(proofDir, proof.key), `${JSON.stringify(proof, null, 2)}\n`);
}

/** Where an app stands, from its proof alone. Tutti reads the same words. */
export function stateOf(proof) {
  if (proof.changedOn) {
    return "changed";
  }
  if ((proof.failures ?? 0) >= 2) {
    return "failing";
  }
  if (proof.review?.verdict === "doubt") {
    return "doubted";
  }
  if (proof.firstSignIn) {
    return "listed";
  }
  if (proof.signInPage && proof.review?.verdict === "pass") {
    return "not-tried";
  }
  return "drafted";
}

export const today = () => new Date().toISOString().slice(0, 10);

export function daysSince(date, now = new Date()) {
  return Math.floor((now.getTime() - new Date(date).getTime()) / 86_400_000);
}

/** Run a job over a list with a few going at once, keeping the order. */
export async function pool(items, size, job) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await job(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

/** Add to the run's own notes, which become status.json at the end of the night. */
export function noteRun(proofDir, name, note) {
  writeFileSync(join(proofDir, `run-${name}.json`), `${JSON.stringify(note)}\n`);
}
