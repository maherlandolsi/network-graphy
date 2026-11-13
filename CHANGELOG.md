# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-13

### Added
- Filter the request list by GraphQL operation (dropdown with call counts).
- Collapsible JSON tree for responses, with *copy path* on every key.
- Tree search by key and/or value (`sku`, `status=SHIPPED`, `=ACTIVE`, `email=`, `edges.node.id`) showing a filtered tree.
- Duplicate-call detection (`dup ×N` badge) for identical operations + variables within 5 s.
- Live WebSocket and EventSource capture with a *Messages* tab; GraphQL subscription messages (`graphql-transport-ws`, `subscriptions-transport-ws`) are labeled by operation.
- Saved requests: save, edit, replay and export to Postman.
- HAR export (all / filtered) and import, including response bodies and socket messages.
- Copy as `fetch()` and as Postman collection; GraphQL requests export as a Postman collection.
- Waterfall column; sortable, resizable and configurable columns.
- Request / operation bookmarks with a bookmarked-only filter.
- Pinned headers shown first in every header list.
- Edit & Resend for any request, with dedicated GraphQL fields.
- Packaging script, dev server and live test page.

## [0.1.0] - 2026-11-13

### Added
- DevTools panel with request list, type and text filters, and preserve log.
- Hide OPTIONS (preflight) requests.
- GraphQL operation type, name and root fields in the request list.
- Formatted, syntax-highlighted GraphQL queries and variables.
- GraphQL error flagging; batched, GET, persisted and multipart requests.

[Unreleased]: https://github.com/maherlandolsi/network-graphy/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/maherlandolsi/network-graphy/releases/tag/v0.2.0
[0.1.0]: https://github.com/maherlandolsi/network-graphy/releases/tag/v0.1.0
