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
  "modal.run",
  "netlify.app",
  "ngrok.app",
  "ngrok.io",
  "onrender.com",
  "pages.dev",
  "railway.app",
  "replit.app",
  "run.app",
  "trycloudflare.com",
  "vercel.app",
  "web.app",
  "workers.dev",
];

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
      errors.push(`Unknown field: ${field}.`);
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
  } else if (RENTED_HOSTS.some((host) => isUnder(app.company, host))) {
    errors.push("company can't be a domain anyone can rent a name on.");
  }
  const connect = app.connect;
  if (connect === null || typeof connect !== "object" || Array.isArray(connect)) {
    errors.push("connect must say how the app connects.");
    return errors;
  }
  for (const field of Object.keys(connect)) {
    if (!CONNECT_FIELDS.includes(field)) {
      errors.push(`Unknown field: connect.${field}.`);
    }
  }
  if (connect.kind !== "mcp") {
    errors.push('connect.kind must be "mcp".');
  }
  errors.push(...serverErrors(connect.server, app.company));
  return errors;
}

/** Every app file under a folder, whether it reads or not. */
export function listApps(root) {
  const folder = join(root, "apps");
  return readdirSync(folder)
    .sort()
    .map((fileName) => {
      if (!fileName.endsWith(".json")) {
        return { fileName, errors: ["Only .json files belong in apps."] };
      }
      const text = readFileSync(join(folder, fileName), "utf8");
      let app;
      try {
        app = JSON.parse(text);
      } catch {
        return { fileName, text, errors: ["The file isn't valid JSON."] };
      }
      return { fileName, text, app, errors: validateApp(fileName, app) };
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

async function readJson(url, fetchFn) {
  try {
    const response = await fetchFn(url, {
      headers: {
        accept: "application/json",
        "mcp-protocol-version": "2025-06-18",
        "user-agent": USER_AGENT,
      },
      signal: timeout(),
    });
    if (!response.ok) {
      return undefined;
    }
    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) {
      return undefined;
    }
    const json = JSON.parse(text);
    return json !== null && typeof json === "object" ? json : undefined;
  } catch {
    return undefined;
  }
}

async function firstJson(urls, fetchFn) {
  for (const url of urls) {
    const json = await readJson(url, fetchFn);
    if (json) {
      return json;
    }
  }
  return undefined;
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

const sha256 = (text) => createHash("sha256").update(text).digest();

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

  const resourceMetadata = await firstJson(resourceAddresses(serverUrl), fetchFn);
  if (resourceMetadata && !namesThisServer(resourceMetadata.resource, serverUrl)) {
    return failed("It names a resource other than itself.");
  }

  let authorizationServer;
  try {
    authorizationServer = new URL(
      resourceMetadata?.authorization_servers?.[0] ?? "/",
      serverAddress
    );
  } catch {
    return failed("It names a sign-in server that isn't a valid address.");
  }
  if (authorizationServer.protocol !== "https:" || !isPublicName(authorizationServer.hostname)) {
    return failed("Its sign-in server must be https on a public name.");
  }

  const metadata = await firstJson(signInAddresses(authorizationServer), fetchFn);
  if (!metadata?.authorization_endpoint || !metadata?.token_endpoint) {
    return failed("It doesn't say where to sign in.");
  }
  const challenges = metadata.code_challenge_methods_supported;
  if (Array.isArray(challenges) && !challenges.includes("S256")) {
    return failed("Its sign-in server doesn't support S256.");
  }

  const scopes = new Set(resourceMetadata?.scopes_supported ?? []);
  if (metadata.scopes_supported?.includes("offline_access")) {
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
    signInHost: authorizationServer.hostname,
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

/**
 * Register a client named Tutti at the company and load its sign-in page, the
 * way Tutti does when someone connects. This grants nothing: nobody approves
 * anything, and the client's id and secret are thrown away unread by any log.
 */
export async function openSignInPage(found, fetchFn = fetch) {
  const { metadata } = found;
  const secretAllowed =
    metadata.token_endpoint_auth_methods_supported?.includes("client_secret_post");

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
      return { ok: false, reason: `Registering answered ${registered.status}.` };
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
    const page = await fetchFn(signInUrl, {
      headers: { accept: "text/html", "user-agent": USER_AGENT },
      redirect: "manual",
      signal: timeout(),
    });
    if (page.status >= 300 && page.status < 400) {
      const location = page.headers.get("location") ?? "";
      await page.body?.cancel();
      return location.startsWith(REDIRECT_URI)
        ? { ok: false, reason: "The sign-in page sent Tutti straight back with an error." }
        : { ok: true };
    }
    if (page.status !== 200) {
      await page.body?.cancel();
      return { ok: false, reason: `The sign-in page answered ${page.status}.` };
    }
    const body = (await page.text()).slice(0, MAX_BODY_CHARS);
    return NOT_ACCEPTED.test(body)
      ? { ok: false, reason: "The sign-in page refused Tutti's return address." }
      : { ok: true };
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
