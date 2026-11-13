# Security and privacy

## Data handling

Network+ runs entirely in your browser:

- It sends no data to any server and collects no telemetry.
- Captured requests, responses and socket messages stay in the DevTools window and are discarded when it closes (unless you export them).
- Settings, bookmarks and saved requests are stored in the extension's local storage on your machine.
- The page script (`content/hook.js`) observes WebSocket/EventSource messages in each page, and they are forwarded to the panel **only while DevTools with Network+ is open on that tab**.
- *Edit & Resend* replays requests from the inspected page, with that page's cookies.

HAR exports and saved requests can contain credentials (cookies, authorization headers, tokens). Review them before sharing.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/maherlandolsi/network-graphy/security/advisories/new)
instead. You can expect a first response within a week.
