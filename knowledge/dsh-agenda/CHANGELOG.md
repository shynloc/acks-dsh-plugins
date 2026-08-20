# dsh-agenda

Changes that a consumer of this package would notice. Entries cover releases
only; work that happened while a version was being built is not a change to it.

## 0.2.1

- Fixed: optional cross-domain authorities are resolved through
  `ctx.reflect.get` rather than a bare `ctx.<service>` read. A bare read
  throws under real Cordis, and adding the name to `inject` would have made
  the capability required and deactivated the plugin whenever it was absent.
  Every cross-domain write previously returned a generic 500.
- Fixed: the same-origin fallback compares the origin's scheme, not only its
  host. The Host header carries no scheme, so `http://app.example` and
  `https://app.example` were treated as one origin.
