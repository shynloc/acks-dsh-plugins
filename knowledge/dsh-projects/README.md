# dsh-projects

The authoritative Project record for DeepSeek Harness Work OS. Single-user and
local-first: title, objective, phase, optional start/end dates, tags, and a
reversible archive.

It publishes one Work OS destination, `knowledge.projects`, replacing that
section's planned placeholder, and falls back to one reversible standalone DSH
surface when Work OS is absent.

## Project is authoritative only here

This plugin owns the Project id, phase, dates, lifecycle and revision. It is a
foundation slice, not the final Projects panorama: it deliberately does **not**
model task, note, bookmark, session or file relations, because inventing those
before a shared reference contract exists would hard-code foreign models and
create migration debt.

When cross-domain relations arrive, another domain may store a reference to a
project id. It must never copy the Project object.

## The reference authority

Other domains never copy a Project. They store only their own nullable
`projectId`, and validate it against one tiny Cordis service this plugin
publishes:

```js
ctx.reflect.provide("acksProjects", Object.freeze({ exists(id) }))
```

`exists` answers one question — does this canonical UUID name a stored Project —
and nothing else. There is deliberately no getter and no list: either would let
another domain duplicate Project data and drift from this authority.

An **archived** project still exists. Projects has no delete route, so an accepted
reference stays valid for the life of the record: archiving never cascades into a
task or a bookmark, and never destroys a link.

Consumers treat the service as an *optional* capability rather than a required
injection, so a domain remains usable for unlinked records if Projects is absent.
A non-null link attempted without the service is refused with `503` rather than
stored as a dangling reference.

Projects is itself a consumer. A Project carries a nullable `areaId` validated
through `acksAreas`, so a Project can sit inside the ongoing responsibility it
serves without either record copying the other. The reference survives archive
and restore, and a lifecycle body still carries only `expectedRevision`.

In the browser the Area selector reads `/api/areas/state` on its own, so an
Areas outage warns beside the selector and never blanks Projects. The related
projection now covers Notes alongside Agenda tasks and Bookmarks; a note is
projected by title and size only, because its Markdown body belongs to Notebook.

## Related work is a projection, not a store

The Project detail panel reads Agenda and Bookmarks state and filters by
`projectId`. It is strictly read-only:

- nothing from either source is stored in Projects or sent in a Project request
  body — the edit body carries only Project fields;
- a related bookmark URL renders as **text**, not an anchor: the link affordance
  belongs to the domain that owns the record;
- each source is settled independently, so one outage shows a warning beside that
  source while the other list and the Project detail stay fully visible;
- refreshing re-reads both sources and never touches the Project revision or an
  open draft.

## Optimistic concurrency

Every mutation carries `expectedRevision`. `revision` starts at 1 and increments
exactly once per accepted mutation, so a stale write is refused with `409` and
changes nothing, rather than silently overwriting a newer one. The compare and
the write happen inside the same serialized operation, which is what makes two
concurrent edits resolve deterministically to one success and one conflict.

## Architecture

- **Host** (`lib/index.js`): a same-origin JSON API under `/api/projects` over
  one revisioned DSH JSON storage unit (`projects`, tables `["projects"]`).
- **Client** (`lib/client.js`): buildless browser module. One shared store loads
  `/state`; the list, search, detail panel and editor all read from it and write
  through one path. Every value renders as React text — no anchor, URL or markup
  is ever constructed from stored data.

Detail lands with the implementation.
