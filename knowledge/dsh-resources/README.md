# dsh-resources

The authority for a **Resource**: a reusable curated asset or topic.

## A Resource is not a second bookmark

A Resource never stores a URL of its own. An external address is represented by
a **Bookmark reference**, so the canonical URL keeps exactly one owner and two
records can never disagree about what a link is.

What a Resource adds is curation: a kind, an active/dormant status, an optional
Area it serves, and an optional source it came from.

## The source pair

`sourceType` and `sourceId` are validated as one unit, never independently:

| `sourceType` | `sourceId` | Checked against |
| --- | --- | --- |
| `none` | must be empty | — |
| `note` | canonical UUID (versions 1-5) | `acksNotebook.existsNote` |
| `bookmark` | canonical UUID (version 4) | `acksBookmarks.exists` |
| `workspace` | safe relative POSIX path | nothing — see below |

A bookmark id under `sourceType: "note"` is well-formed on its own and
meaningless together, so the pair is always resolved from the type outward.

**Changing the type alone is refused.** The shapes overlap — a UUID is also a
syntactically valid relative path — so re-resolving a stored id under a new type
would quietly turn a note reference into a workspace path naming a file nobody
meant. A type change must state the id it goes with. Moving to `none` is the one
exception: it clears the id outright.

## A workspace source is a string, not a handle

The host stores the path and **never reads, stats, opens or serves it**. The
validation exists so a stored value can never be *interpreted* as an escape by a
future consumer: no absolute path, no drive letter, no URL, no control
character, no empty segment, no `.` or `..`, at most 1024 code points.

Backslashes are rejected rather than translated. Silently rewriting a
Windows-style path would make two different strings name one resource and would
hide a caller passing a native path where a POSIX one belongs.

Together with the no-URL rule, this is what keeps the plugin free of SSRF and
path-traversal surface: there is nothing here that resolves anything.

## Reference authority

Other domains never copy a Resource. They store only its id, validated against
one tiny Cordis service:

```js
ctx.reflect.provide("acksResources", Object.freeze({ exists(id) }))
```

An archived resource still exists: this plugin has no delete route, so an
accepted reference stays valid for the life of the record.

The authorities this plugin *consumes* are optional capabilities read through
`ctx.reflect.get(name)`. A bare `ctx.<service>` read throws in real Cordis, and
declaring the names in `inject` would make them required — leaving this plugin
inactive whenever another domain is absent. Each is independent: an absent
Notebook never blocks an Area link, and a workspace or absent source needs no
authority at all. A requested non-null link is refused with `503` rather than
stored as a dangling reference.

## Architecture

- **Host** (`lib/index.js`): a same-origin JSON API under `/api/resources` over
  one revisioned DSH JSON storage unit (`resources`, tables `["resources"]`).
  Every mutation carries an `expectedRevision`; the compare and the write share
  one serialized operation, so two concurrent edits resolve deterministically.
  There is no permanent delete.

## The workspace source is copy-only

The detail panel hands a workspace path back as **text** and nothing more. There
is deliberately no open, no reveal and no `file://` link: the host stores the
path and never resolves it, and the browser has no business reaching into the
workspace either. A shape test asserts the client contains no `href:` and no
`file://` at all.

## Client

`lib/client.js` publishes the `knowledge.resources` Work OS destination through
browser contract v1, with the same queued registration and bounded standalone
fallback the other destinations use.

The source control follows the chosen type — a picker for a note or bookmark, a
path field for a workspace file, nothing for `none`. Changing the type clears the
id it no longer describes, mirroring the host rule: the shapes overlap, so
carrying the old id over would silently mean something different.

Each owner is read on its own, so an outage warns beside the selector it explains
and never blanks the destination. A reference that no longer resolves is named
plainly rather than rendered blank or as a raw id, and no referenced title, name
or URL is ever copied into a Resource payload.
