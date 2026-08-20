# dsh-agenda

Native Agenda module for DeepSeek Harness Work OS. Single-user, local-first, and
built from one authoritative task lifecycle: Calendar, Review and Archive are
projections of the same records rather than separate stores.

## Destinations

| Destination | Order | Purpose |
| --- | ---: | --- |
| `agenda.calendar` | 10 | Monday-first month grid with a selected-day task list |
| `agenda.tasks` | 20 | Create, edit, complete/reopen and archive tasks |
| `agenda.review` | 30 | Overdue, today, next seven days, unscheduled, recently completed |
| `agenda.archive` | 40 | Reversible archived-task list with restore |

All four register through Work OS browser contract v1. When Work OS is absent,
the plugin instead exposes exactly one standalone DSH surface, using the same
bounded-wait handshake as `dsh-notebook`.

## Architecture

- **Host** (`lib/index.js`): a same-origin JSON API under `/api/agenda` over one
  revisioned DSH JSON storage unit (`agenda`, tables `["tasks"]`). All mutations
  are serialized through one queue; no browser-supplied id or timestamp is
  trusted.
- **Client** (`lib/client.js`): buildless browser module. One shared store loads
  `/state` and holds the authoritative snapshot; every destination reads from it
  and writes through one path.

## Task lifecycle

`open → completed → archived`, with `restore` returning a task to whichever state
it was archived from. Editing title, notes, date, time, priority or order never
changes lifecycle state. Every invalid transition is a `409` that leaves the
stored record untouched. **There is no permanent delete**: archiving is the only
removal, and it is reversible.

## Review projections

Buckets are disjoint and computed from local calendar dates:

| Bucket | Rule |
| --- | --- |
| Overdue | open, `dueDate` before today |
| Today | open, `dueDate` is today |
| Next seven days | open, `dueDate` from tomorrow through today + 7 |
| Unscheduled | open, no `dueDate` — counted here, absent from the calendar |
| Recently completed | completed within the last seven local calendar days |

Archived tasks appear in no bucket and on no calendar day.

## REST contract

Prefix `/api/agenda`. Envelopes are `{ok:true,...}` or `{ok:false,error}`.

| Method | Path |
| --- | --- |
| GET | `/state` |
| POST | `/tasks` |
| PATCH | `/tasks/:id` |
| POST | `/tasks/:id/complete` |
| POST | `/tasks/:id/reopen` |
| POST | `/tasks/:id/archive` |
| POST | `/tasks/:id/restore` |

## Project references

A task carries a nullable `projectId` and nothing else about a Project: no title,
phase or revision is ever copied in, so the two records cannot drift.

- A record written before references existed has no such property and presents as
  `null`. There is no migration.
- A non-null value must be a lowercase canonical UUID **and** must exist,
  verified against the `acksProjects` service published by `dsh-projects`.
- `null` and `""` both mean "no link" and need no authority to apply.
- `acksProjects` is an *optional* capability, not a required injection, so a
  standalone Agenda stays fully usable for unlinked work. While it is missing, a
  non-null link is refused with `503` rather than stored as a dangling reference.
- Archiving or completing a task preserves its reference; lifecycle bodies stay
  empty and reject `projectId` like any other field.

## Safety limits

- `POST`/`PUT`/`PATCH`/`DELETE` are rejected `403` **before parsing or routing**
  unless the request is same-origin. `Sec-Fetch-Site` is authoritative when
  present; otherwise a present `Origin` must agree with `Host`. Reads stay
  available because no `Access-Control-Allow-Origin` header is ever sent.
- Bodies are capped at 128 KiB by declared length and while streaming; a
  non-`application/json` content type is `415` and malformed JSON is `400`.
- Titles are trimmed, measured in Unicode code points (1–200) and reject control
  characters. Notes are capped at 20,000 characters, `orderIndex` at 1,000,000,
  and the store at 10,000 tasks.
- `dueDate` must be a real Gregorian date (`2026-02-29` is refused), and
  `dueTime` is only valid alongside a date. Clearing the date clears the time.
- `id`, `status` and all timestamps are server-owned and rejected if supplied,
  rather than silently ignored.
- Responses send `no-store`, `nosniff`, `referrer-policy: no-referrer` and
  `content-security-policy: default-src 'none'; frame-ancestors 'none'`.
- Unexpected errors are logged server-side and returned as a generic
  `500 internal server error`.
- Mutations are serialized through one queue; a rejected write cannot poison
  later ones.
- Client styles are scoped entirely under `.dsh-agenda-root`; the plugin writes
  no global body style and removes its stylesheet on disposal.
