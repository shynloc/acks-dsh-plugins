# dsh-areas

The authoritative Area record for DeepSeek Harness Work OS. Single-user and
local-first: name, purpose, status, review cadence, tags and a reversible
archive.

It publishes one Work OS destination, `knowledge.areas`, replacing that
section's planned placeholder, and falls back to one reversible standalone DSH
surface when Work OS is absent.

## An Area is a responsibility, not a piece of work

A Project ends; an Area does not. The record therefore has **no** due date, no
completion state and no copied task list — it carries a review cadence instead,
because the question an Area answers is "when did I last look at this", not "is
it done".

Work that does end belongs to a Project, which may reference this Area.

## Architecture

- **Host** (`lib/index.js`): a same-origin JSON API under `/api/areas` over one
  revisioned DSH JSON storage unit (`areas`, tables `["areas"]`), using the same
  optimistic-concurrency contract Projects established: `revision` starts at 1,
  every mutation carries `expectedRevision`, and the compare and the write share
  one serialized operation.
- **Reference service**: a frozen `acksAreas` exposing only `exists(id)`, so
  another domain can validate a reference without ever copying an Area.
- **Client** (`lib/client.js`): buildless browser module. Every value renders as
  React text; no anchor, URL or markup is built from stored data.

Detail lands with the implementation.

## Related work

The Area detail projects the Projects, Bookmarks, Notes and Resources that carry
this Area's id. It is a read-only projection over each owner's existing same-origin
state route: Areas stores nothing from any source, offers no action on a
projected record, and renders every value as text — a related bookmark URL is
deliberately not an anchor here, because link affordances belong to the domain
that owns the record. Each source is settled independently, so one outage warns
inside its own group while the others and the Area detail stay fully visible.
Refresh is explicit; there is no global event bus.

A resource is projected by title and kind: its summary belongs to Resources, and
its source is never turned into a link here. Live and archived counts are exact
and separate, so an Area review is not misled by a pile of archived material.

Agenda is deliberately absent. A task reaches an Area through its Project, so
projecting tasks here would invent a second path that could contradict the
first.
