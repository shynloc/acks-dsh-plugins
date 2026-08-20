# dsh-knowledge-archives

One read-only aggregate over every domain that owns archived records.

## This plugin is not an authority

It stores nothing, publishes no service and has no endpoint of its own. The
**host half is deliberately empty** — no storage unit, no table, no API prefix,
no request handler, and an empty `inject` because there is nothing to inject.
Tests assert all of that.

That is the whole design. Every archived record already has exactly one owner,
and each owner already enforces its own lifecycle, revision and validation
rules. A second place that believed it knew what is archived would eventually
disagree with the first.

So the browser half reads each owner's existing same-origin state route, filters
for that owner's own spelling of "archived", and restores a record by calling
the owner's own restore endpoint.

## Two contracts, not one

The owners genuinely differ, and flattening them would be a defect rather than a
simplification:

| Owner | Archived marker | Restore body |
| --- | --- | --- |
| Agenda task | `status` | `{}` — rejected if non-empty |
| Bookmark | `status` | `{}` — rejected if non-empty |
| Project | `lifecycle` | `{ expectedRevision }` |
| Area | `lifecycle` | `{ expectedRevision }` |
| Resource | `lifecycle` | `{ expectedRevision }` |

Sending a revision where none is accepted is a `400`; omitting one where it is
required would let a stale restore win. The adapter therefore carries each
owner's shape.

**Notebook is absent on purpose.** It has no reversible archive lifecycle, only
a permanent delete, so there is nothing here to restore.

## What the projection guarantees

- Each owner loads and fails on its own: one outage reports inside its own group
  and never hides the other four.
- The **server response decides**. A record leaves the list because its owner
  said it is no longer archived — never because the call returned.
- One pending restore disables only its own control.
- Ordering is newest-archived first with a deterministic tie-break, so a reload
  cannot reshuffle two records archived in the same millisecond.
- Every value is text. A bookmark URL belongs to Bookmarks; in an aggregate it is
  not an anchor.
- There is **no permanent delete** anywhere, and no aggregate write endpoint.
