# dsh-knowledge-archives

Changes that a consumer of this package would notice. Entries cover releases
only; work that happened while a version was being built is not a change to it.

## 0.2.0

- Added: Notebook is a sixth owner. It was excluded while it had no reversible
  archive — there was nothing to restore — and joined once `dsh-notebook`
  0.7.0 made archiving reversible. It archives with `status` and takes an
  empty lifecycle body, like Agenda and Bookmarks.
- Fixed: a record whose owner never set `archivedAt` no longer renders as
  "存档于 1970-01-01". `formatDay` fell through to `new Date(0)`, which is a
  valid date, so the unknown-date fallback beside it was unreachable. Such a
  record is now labelled unknown, is not silently dropped by a since-filter
  that cannot judge it, and still sorts last.
