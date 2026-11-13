# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-11-13

### Fixed
- The panel froze (and stopped listing new requests) after opening the response of a large CSS or minified JS file: formatting took time proportional to the square of the file size. Formatting is now linear (a 3 MB stylesheet formats in about 0.1 s).
- On reload, the page's own document and first scripts could disappear from the list when Firefox reported the navigation after they had loaded. The new page's requests are now kept and only the previous page's are cleared.

### Changed
- JavaScript responses, and inline scripts in HTML, are shown as received instead of being reformatted.
- Responses over 500 kB are shown without syntax highlighting.

## [0.3.0] - 2026-11-13

### Added
- Pretty-printed, syntax-highlighted HTML, XML/SVG and CSS responses, and highlighted JavaScript, with *Pretty / Raw* views and *Copy formatted*.
- HTML preview (sandboxed, scripts disabled) and SVG preview.
- Edit & Resend: *Format JSON* and *Minify* for request bodies, with live JSON validation (form-urlencoded bodies switch between `a=1&b=2` and one pair per line).

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

[Unreleased]: https://github.com/maherlandolsi/network-graphy/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/maherlandolsi/network-graphy/releases/tag/v0.3.1
[0.3.0]: https://github.com/maherlandolsi/network-graphy/releases/tag/v0.3.0
[0.2.0]: https://github.com/maherlandolsi/network-graphy/releases/tag/v0.2.0
[0.1.0]: https://github.com/maherlandolsi/network-graphy/releases/tag/v0.1.0
