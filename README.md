# Tutti apps

Apps that work with [Tutti](https://tuttiwork.com), where your AIs and apps do jobs together as workflows.

Every app here connects to the server its own company runs, over [MCP](https://modelcontextprotocol.io). A file in `apps` names the app and that company's server. This repo holds no code from those companies, and nobody's sign-in passes through it: people sign in on the company's own page.

## Where an app stands

| State | What it means |
| --- | --- |
| Drafted | The file is here, but its checks haven't all passed. Some companies only let in return addresses on their own list, so they need to add Tutti's first. |
| Not tried yet | Its server answers, its sign-in page opens for Tutti, and a second agent found no reason to doubt it. Anyone can try it from a workspace. Nobody has yet. |
| Listed | Someone connected it for real. It shows on the [public list](https://tuttiwork.com/apps). |
| Doubted | The second agent couldn't support the entry. It stays off every list until someone looks. |
| Changed | Its sign-in server moved since we last looked. It stays off every list until someone looks. |
| Failing | Its server hasn't answered properly for two nights. |

Connecting for real is the only way onto the public list. The date comes from Tutti when a real connection is made, and all it publishes is that date and how many tools the server offered. No names of people or workspaces.

## Ask for an app

[Open an issue](../../issues/new?template=ask-for-an-app.yml) with the app's name. Agents pick up what's asked for most, one a night. If its company runs a server that apps can sign in to by themselves, the app gets a draft for someone to review. If it doesn't, the issue says so.

## Add an app

Add one file and open a pull request. [CONTRIBUTING](CONTRIBUTING.md) has the format, and it takes about five minutes if you know the server's address.

## What runs here

Pull requests get read-only checks: the file's format, and what its server says publicly about signing in. Those checks hold no secrets. They register nothing, because anyone can open a pull request.

Every night, a job reads each app's server and writes what it found to the `proof` branch. It holds no token, so it can't see anyone's data. The first time an app's server reads well, the job also registers a client named Tutti with that company and opens its sign-in page, the same way Tutti does when someone connects. That grants nothing: nobody approves anything and the client is thrown away.

Two agents also run at night. One looks for the most wanted app's server, puts one file on a branch and opens an issue with a link that starts the pull request. The other, which didn't write the file, tries to find a reason the address isn't that company's own. Neither can merge anything. A person merges every address, because people will send their sign-ins to it.

## Using this list elsewhere

`catalog.json` on the `proof` branch holds every app and its state, so you can build on it without working the state out yourself.

## Licence

Apache 2.0. The names and logos of the apps here belong to their companies, and none of those companies made this list. See [NOTICE](NOTICE).
