# Contributing

Thanks for your interest in improving Network+!

## Getting started

Requirements: Firefox 128+ and Node.js 20+. There are no dependencies to install.

```sh
git clone https://github.com/maherlandolsi/network-graphy.git
cd network-graphy
npm test        # unit tests (node --test)
npm start       # dev server → http://localhost:8000/test/live.html
```

Load the extension from `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `manifest.json`. After a code change, click **Reload** next to the add-on and reopen DevTools.

For UI work without reloading the extension, open `http://localhost:8000/test/demo.html`: it runs the panel with fake requests. See the README for its URL parameters.

## Where things live

| Area | File |
|---|---|
| GraphQL detection, parsing, formatting | `lib/graphql.js` |
| cURL / fetch / Postman / HAR | `lib/exporters.js` |
| JSON tree and tree search | `panel/tree.js` |
| Panel UI | `panel/panel.js`, `panel/panel.css` |
| Request capture, Edit & Resend | `devtools/devtools.js` |
| WebSocket / EventSource capture | `content/hook.js` → `content/relay.js` → `background.js` |

## Guidelines

- Keep it dependency-free and build-free: plain JavaScript that Firefox loads directly.
- Add or update unit tests in `test/` for logic in `lib/` and `panel/tree.js`.
- Never insert untrusted data with `innerHTML`; build DOM nodes or escape with `GraphQLUtils.escapeHtml`.
- `content/hook.js` runs inside every page: it must never change page behavior or throw.
- Run `npm run check && npm test` before opening a pull request, and add a line to `CHANGELOG.md` under *Unreleased*.
- Use short, imperative commit messages (e.g. `Add tree search by value`).

## Reporting bugs

Open an issue with your Firefox version, steps to reproduce, and, if possible, a HAR export (Network+ → **Export ▾**) with any sensitive data removed.
