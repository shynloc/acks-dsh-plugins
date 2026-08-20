# dsh-resources

Changes that a consumer of this package would notice. Entries cover releases
only; work that happened while a version was being built is not a change to it.

## 0.1.1

- Fixed: the same-origin fallback compares the origin's scheme, not only its
  host.
- Note: a `referencesNote` reverse lookup was added and removed within this
  release. It existed to let Notebook check for references before deleting a
  note; it went with the delete route it served, because the answer could be
  true when given and false by the time the deletion committed. The published
  surface is unchanged: `acksResources` exposes `exists` only.
