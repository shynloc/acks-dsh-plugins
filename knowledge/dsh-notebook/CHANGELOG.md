# dsh-notebook

Changes that a consumer of this package would notice. Entries cover releases
only; work that happened while a version was being built is not a change to it.

## 0.7.0

- **Breaking**: `DELETE /api/notebook/notes/:id` is gone and returns 405. A
  note is archived, not deleted.

  A guarded delete was tried first and removed: asking Resources whether
  anything referenced the note and then deleting it are two steps with no lock
  between them, and Resources validates its own reference the same way. A
  Resource could therefore be accepted against a note deleted before the
  Resource was written. Two boolean existence checks cannot prevent that; it
  needs one authority holding a lock across both writes.

  An accepted note reference now stays valid for the life of the record, the
  same guarantee Bookmarks and Resources give.
- Added: `POST /api/notebook/notes/:id/archive` and `/restore`, with
  `status`, `archivedFrom` and `archivedAt` on a note. Nothing was
  migrated — a note stored before this reads as active.
- Fixed: the same-origin fallback compares the origin's scheme, not only its
  host.
- Fixed: a rejected note edit no longer banks a content version. Every field is
  validated before the first write.
