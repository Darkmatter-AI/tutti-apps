# Add an app

An app is one JSON file in `apps`, named after its key:

```json
{
  "key": "linear",
  "name": "Linear",
  "category": "projects",
  "blurb": "Issues and projects",
  "company": "linear.app",
  "connect": {
    "kind": "mcp",
    "server": "https://mcp.linear.app/mcp"
  }
}
```

| Field | What goes in it |
| --- | --- |
| `key` | Lower-case letters and numbers, with single hyphens. The file is called `<key>.json`. |
| `name` | The app's name as its company writes it. |
| `category` | One of `projects`, `mail-and-calendar`, `chat`, `docs`, `code`, `design`, `analytics`, `support`, `forms-and-booking`, `payments`, `ai-models`, `web-data`, `social`, `media`, `websites`. Use `other` if none fits. |
| `blurb` | What it is, in a few plain words. |
| `company` | The domain of the company that runs the server. |
| `connect.server` | The address of that company's own MCP server, on that domain. |

## What gets refused

- A server that isn't on the company's own domain, or a company on a host where anyone can rent a name.
- An address that names another client, such as `/claude` or `/chatgpt`. It was made for them, and may stop working for anyone else.
- A server that doesn't ask for a sign-in, or whose sign-in server only lets in apps registered with it. Tutti can't add those from a file, so please ask for them in an issue instead.

## Before you open a pull request

These need nothing but Node 24:

```bash
node --test "scripts/*.test.mjs"
```

```bash
node scripts/check-files.mjs --root .
```

## What happens next

The checks read your file and what its server says publicly about signing in, then lay that out for the person who reviews it. That person's one question is whether the address is really that company's own, because people will send their sign-ins to it. A merged app is checked every night from then on.

Keep a change to `apps` to app files alone, written just as the format above shows, so what a person reads is exactly what the checks read.

If you change anything in `scripts`, the checks still run the versions on `main` against your files, and your own scripts' tests run on their own.
