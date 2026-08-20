# dsh-areas

Changes that a consumer of this package would notice. Entries cover releases
only; work that happened while a version was being built is not a change to it.

## 0.2.1

- Fixed: the same-origin fallback compares the origin's scheme, not only its
  host. A page served over plain HTTP to the same authority could otherwise
  drive writes into the HTTPS app.
