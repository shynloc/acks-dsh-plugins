# dsh-bookmarks

Native bookmark manager for DeepSeek Harness Work OS. Single-user and
local-first: title, HTTP(S) URL, plain-text notes, tags and reading state, with
search, inline editing and a reversible archive.

It publishes one Work OS destination, `knowledge.bookmarks`, replacing that
section's planned placeholder, and falls back to one reversible standalone DSH
surface when Work OS is absent.

## This plugin never fetches a bookmark

The host stores links and nothing else. It performs no page fetch, no redirect
following, no DNS resolution, no Open Graph or readability extraction, no
screenshot and no favicon download. Because nothing is ever requested, this
milestone introduces **no SSRF or remote-content parsing surface**, and storing a
loopback or private-network URL is therefore harmless.

Any future snapshot, metadata or capture feature needs its own milestone and its
own threat review. It must not be added here.

## Reference authority

Other domains never copy a Bookmark. They store only their own nullable bookmark
id, and validate it against one tiny Cordis service this plugin publishes:

```js
ctx.reflect.provide("acksBookmarks", Object.freeze({ exists(id) }))
```

`exists` answers one question — does this canonical UUID name a stored Bookmark —
and nothing else. There is deliberately no getter and no list: either would let
another domain duplicate a title or a URL and drift from this authority.

An **archived** bookmark still exists. Bookmarks has no delete route, so an
accepted reference stays valid for the life of the record.

Bookmarks is also a consumer. A bookmark carries two independent nullable
references — `projectId` validated through `acksProjects`, and `areaId` validated
through `acksAreas`. Neither implies the other: a link filed under an Area need
not belong to a Project. Each authority is optional on its own, so one absent
service never disables the other, and neither reference takes any part in URL
canonicalization or duplicate detection — the canonical URL alone decides
whether two bookmarks are the same resource.

In the browser each selector reads its owner's state route on its own, so one
outage warns beside its own selector and leaves the other selector and the whole
list usable. A referenced title or name is rendered as text and is searchable,
but never becomes an anchor — only the bookmark's own host-validated URL is a
link.

## Architecture

- **Host** (`lib/index.js`): a same-origin JSON API under `/api/bookmarks` over
  one revisioned DSH JSON storage unit (`bookmarks`, tables `["bookmarks"]`).
  URL normalization, deduplication and the lifecycle are authoritative here.
- **Client** (`lib/client.js`): buildless browser module. One shared store loads
  `/state`; the list, search, create form and inline editor all read from it and
  write through one path.

Detail lands with the implementation.
