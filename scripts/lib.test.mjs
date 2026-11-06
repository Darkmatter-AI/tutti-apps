import assert from "node:assert/strict";
import { test } from "node:test";
import {
  crossFileErrors,
  discover,
  isPublicName,
  openSignInPage,
  plain,
  pool,
  REDIRECT_URI,
  stateOf,
  validateApp,
} from "./lib.mjs";

const good = () => ({
  key: "linear",
  name: "Linear",
  category: "projects",
  blurb: "Issues and projects",
  company: "linear.app",
  connect: { kind: "mcp", server: "https://mcp.linear.app/mcp" },
});

const errorsWith = (change) => {
  const app = good();
  change(app);
  return validateApp("linear.json", app);
};

test("a good app has no errors", () => {
  assert.deepEqual(validateApp("linear.json", good()), []);
});

test("the file must be named after the key", () => {
  assert.match(validateApp("other.json", good())[0], /linear\.json/);
});

test("a field nobody knows about is refused", () => {
  assert.match(errorsWith((app) => { app.logo = "x"; })[0], /Unknown field: logo/);
  assert.match(errorsWith((app) => { app.connect.scopes = "x"; })[0], /connect\.scopes/);
});

for (const [what, change] of Object.entries({
  "markup in a name": (app) => { app.name = "<b>Linear</b>"; },
  "a link in a name": (app) => { app.name = "https://evil.example"; },
  "a mention in a blurb": (app) => { app.blurb = "Ask @someone"; },
  "a markdown link in a blurb": (app) => { app.blurb = "[Linear](https://evil.example)"; },
  "an unknown category": (app) => { app.category = "sales"; },
  "an unknown kind": (app) => { app.connect.kind = "api"; },
  "http": (app) => { app.connect.server = "http://mcp.linear.app/mcp"; },
  "a name in the address": (app) => { app.connect.server = "https://me:pw@mcp.linear.app/mcp"; },
  "a port": (app) => { app.connect.server = "https://mcp.linear.app:8443/mcp"; },
  "a query": (app) => { app.connect.server = "https://mcp.linear.app/mcp?team=1"; },
  "a fragment": (app) => { app.connect.server = "https://mcp.linear.app/mcp#x"; },
  "not an address": (app) => { app.connect.server = "mcp.linear.app"; },
  "another company's domain": (app) => { app.connect.server = "https://mcp.linear.app.evil.example/mcp"; },
  "a domain that only ends the same": (app) => { app.connect.server = "https://evillinear.app/mcp"; },
  "a path made for Claude": (app) => { app.connect.server = "https://mcp.linear.app/claude/mcp"; },
  "a path made for another client": (app) => { app.connect.server = "https://mcp.linear.app/chatgpt_app_mcp"; },
  "a rented host": (app) => {
    app.company = "linear.vercel.app";
    app.connect.server = "https://linear.vercel.app/mcp";
  },
  "a bare IP": (app) => {
    app.company = "169.254.169.254";
    app.connect.server = "https://169.254.169.254/mcp";
  },
  "a private name": (app) => {
    app.company = "metadata.internal";
    app.connect.server = "https://metadata.internal/mcp";
  },
})) {
  test(`refuses ${what}`, () => {
    assert.ok(errorsWith(change).length > 0);
  });
}

test("the same server or name twice is refused", () => {
  const app = good();
  const twin = { ...good(), key: "linear-two", name: "Linear two" };
  assert.match(crossFileErrors([{ fileName: "a.json", app }, { fileName: "b.json", app: twin }])[0], /same server/);
  const namesake = { ...good(), connect: { kind: "mcp", server: "https://mcp.linear.app/v2" } };
  assert.match(crossFileErrors([{ fileName: "a.json", app }, { fileName: "b.json", app: namesake }])[0], /same name/);
});

test("isPublicName", () => {
  assert.equal(isPublicName("mcp.linear.app"), true);
  assert.equal(isPublicName("localhost"), false);
  assert.equal(isPublicName("10.0.0.1"), false);
  assert.equal(isPublicName("printer.local"), false);
});

test("plain leaves no way to link or mention", () => {
  assert.equal(plain("see [here](https://evil.example) @someone"), "see here (https evil.example) someone");
  assert.equal(plain("x".repeat(500)).length, 200);
  assert.equal(plain(undefined), "");
});

test("pool keeps the order", async () => {
  assert.deepEqual(await pool([3, 1, 2], 2, async (n) => n * 2), [6, 2, 4]);
});

test("an app's state comes from its proof", () => {
  const pass = { verdict: "pass" };
  assert.equal(stateOf({}), "drafted");
  assert.equal(stateOf({ signInPage: "2026-11-06" }), "drafted");
  assert.equal(stateOf({ signInPage: "2026-11-06", review: pass }), "not-tried");
  assert.equal(stateOf({ signInPage: "2026-11-06", review: { verdict: "doubt" } }), "doubted");
  assert.equal(stateOf({ firstSignIn: "2026-11-06", review: pass }), "listed");
  assert.equal(stateOf({ firstSignIn: "2026-11-06", failures: 2 }), "failing");
  assert.equal(stateOf({ firstSignIn: "2026-11-06", failures: 1 }), "listed");
  assert.equal(stateOf({ firstSignIn: "2026-11-06", changedOn: "2026-11-07" }), "changed");
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** A fake internet: a server that wants a sign-in and a sign-in server beside it. */
function server(overrides = {}) {
  const pages = {
    "https://mcp.acme.example/.well-known/oauth-protected-resource/mcp": () =>
      json({
        resource: "https://mcp.acme.example/mcp",
        authorization_servers: ["https://auth.acme.example"],
        scopes_supported: ["read"],
      }),
    "https://auth.acme.example/.well-known/oauth-authorization-server": () =>
      json({
        issuer: "https://auth.acme.example",
        authorization_endpoint: "https://auth.acme.example/authorize",
        token_endpoint: "https://auth.acme.example/token",
        registration_endpoint: "https://auth.acme.example/register",
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        scopes_supported: ["read", "offline_access"],
      }),
    ...overrides,
  };
  return (url, init) => {
    if (init?.method === "POST" && String(url) === "https://mcp.acme.example/mcp") {
      return Promise.resolve(overrides.post?.() ?? new Response("", { status: 401 }));
    }
    const page = pages[String(url)];
    return Promise.resolve(page ? page() : new Response("", { status: 404 }));
  };
}

const ADDRESS = "https://mcp.acme.example/mcp";

test("discover reads what a server says about signing in", async () => {
  const found = await discover(ADDRESS, server());
  assert.equal(found.ok, true);
  assert.equal(found.signInHost, "auth.acme.example");
  assert.equal(found.registers, true);
  assert.equal(found.renews, true);
  assert.equal(found.scope, "read offline_access");
  assert.match(found.hash, /^sha256:/);
});

test("the hash moves when the sign-in server moves", async () => {
  const first = await discover(ADDRESS, server());
  const moved = await discover(
    ADDRESS,
    server({
      "https://auth.acme.example/.well-known/oauth-authorization-server": () =>
        json({
          issuer: "https://auth.acme.example",
          authorization_endpoint: "https://elsewhere.example/authorize",
          token_endpoint: "https://auth.acme.example/token",
        }),
    })
  );
  assert.notEqual(first.hash, moved.hash);
});

test("a server that lets anyone in has nothing to connect to", async () => {
  const found = await discover(ADDRESS, server({ post: () => json({}) }));
  assert.equal(found.ok, false);
  assert.match(found.reason, /no sign-in/);
});

test("a server that names another resource is refused", async () => {
  const found = await discover(
    ADDRESS,
    server({
      "https://mcp.acme.example/.well-known/oauth-protected-resource/mcp": () =>
        json({
          resource: "https://other.example/mcp",
          authorization_servers: ["https://auth.acme.example"],
        }),
    })
  );
  assert.equal(found.ok, false);
  assert.match(found.reason, /other than itself/);
});

test("a sign-in server on a private address is refused", async () => {
  const found = await discover(
    ADDRESS,
    server({
      "https://mcp.acme.example/.well-known/oauth-protected-resource/mcp": () =>
        json({
          resource: "https://mcp.acme.example/mcp",
          authorization_servers: ["https://169.254.169.254/"],
        }),
    })
  );
  assert.equal(found.ok, false);
  assert.match(found.reason, /public name/);
});

test("a sign-in server without S256 is refused", async () => {
  const found = await discover(
    ADDRESS,
    server({
      "https://auth.acme.example/.well-known/oauth-authorization-server": () =>
        json({
          authorization_endpoint: "https://auth.acme.example/authorize",
          token_endpoint: "https://auth.acme.example/token",
          code_challenge_methods_supported: ["plain"],
        }),
    })
  );
  assert.equal(found.ok, false);
  assert.match(found.reason, /S256/);
});

test("a server that doesn't answer gives a reason, not an exception", async () => {
  const down = () => Promise.reject(new TypeError("fetch failed"));
  const found = await discover(ADDRESS, down);
  assert.equal(found.ok, false);
  assert.match(found.reason, /didn't answer/);
});

const METADATA = {
  metadata: {
    authorization_endpoint: "https://auth.acme.example/authorize",
    registration_endpoint: "https://auth.acme.example/register",
    token_endpoint_auth_methods_supported: ["none"],
  },
  scope: "read",
  resource: ADDRESS,
};

function signIn(page) {
  const seen = {};
  const fetchFn = (url, init) => {
    if (String(url) === METADATA.metadata.registration_endpoint) {
      seen.registered = JSON.parse(init.body);
      return Promise.resolve(json({ client_id: "abc" }, 201));
    }
    seen.opened = new URL(url);
    return Promise.resolve(page());
  };
  return { seen, fetchFn };
}

test("the sign-in page opens as Tutti, the way Tutti would open it", async () => {
  const { seen, fetchFn } = signIn(() => new Response("<form>Sign in</form>", { status: 200 }));
  assert.deepEqual(await openSignInPage(METADATA, fetchFn), { ok: true });
  assert.equal(seen.registered.client_name, "Tutti");
  assert.deepEqual(seen.registered.redirect_uris, [REDIRECT_URI]);
  assert.equal(seen.opened.searchParams.get("client_id"), "abc");
  assert.equal(seen.opened.searchParams.get("code_challenge_method"), "S256");
  assert.equal(seen.opened.searchParams.get("resource"), ADDRESS);
  assert.ok(seen.opened.searchParams.get("state"));
});

test("a redirect on to a login page counts as open", async () => {
  const { fetchFn } = signIn(
    () => new Response(null, { status: 302, headers: { location: "https://auth.acme.example/login" } })
  );
  assert.deepEqual(await openSignInPage(METADATA, fetchFn), { ok: true });
});

test("being sent straight back to Tutti doesn't count", async () => {
  const { fetchFn } = signIn(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: `${REDIRECT_URI}?error=invalid_request` },
      })
  );
  assert.equal((await openSignInPage(METADATA, fetchFn)).ok, false);
});

test("a page refusing the return address doesn't count", async () => {
  const { fetchFn } = signIn(() => new Response("Error: invalid_redirect_uri", { status: 200 }));
  assert.equal((await openSignInPage(METADATA, fetchFn)).ok, false);
});

test("a failed registration says so and shows nothing of the client", async () => {
  const fetchFn = () => Promise.resolve(new Response("nope", { status: 403 }));
  const result = await openSignInPage(METADATA, fetchFn);
  assert.equal(result.ok, false);
  assert.match(result.reason, /403/);
});
