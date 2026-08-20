# dsh-notebook

Notebook plugin for DeepSeek Harness: a native-sidebar entry that opens a notebook in the center workspace without covering DSH navigation.

## Features

- **Sidebar nav tab** in the native DSH sidebar footer (below the workspace, beside Settings).
- **Native SVG controls** throughout; no emoji are used as interface icons.
- **In-app center page** with three view modes: card grid, compact list, and masonry waterfall. The DSH sidebar stays visible, and selecting another session or pressing “Return to conversation” restores the native conversation surface.
- **Conversation capture** in DSH's finalized-assistant action strip. One click saves the associated user/assistant turn, and repeated clicks are idempotent.
- **AI hand-off** on every note card/list row. It creates a session in the current workspace, sends the note as the initial context, and opens that session.
- **Notebook (category) management**: create / rename / delete and drag notes between notebooks.
- **Markdown authoring**: headings, bold, italic, underline, quote, ordered/unordered/task lists, inline/fenced code, links, remote images, tables and separators.
- **Markdown preview**: edit, split and preview modes backed by DSH's own GFM/TeX renderer.
- **Note CRUD**: create / edit / delete (with confirmation), Markdown content, color, word count.
- **Drag a note onto a notebook** to move it (or onto "All notes" to unclassify).
- **Tags**: create / delete colored tags, filter by tag.
- **Full-text search**: substring match over title + content.
- **Version history**: automatic snapshot on content change, restore an older version.
- **Templates**: create a note from a built-in Markdown template.
- **Responsive layout**: desktop sidebar/grid and a compact single-column mobile surface.

## Architecture

- **Host** (`lib/index.js`): registers a same-origin REST API under `/api/notebook` and persists to the already-mounted `ctx.storage` JSON backend (a single `notebook` unit under `$DSH_HOME/storages/`).
- **Client** (`lib/client.js`): registers a nav button and renders the notebook in the center workspace. It never replaces the sidebar or root shell.

### Surface mode

The plugin adds a nav button in `sidebar.footer.action` that temporarily shadows the `conversation` slot at priority `-100`, showing the notebook in the center workspace. The DSH sidebar stays visible; selecting another session or pressing "Return to conversation" restores the native conversation surface.

Capture (`conversation.chat.assistant-actions` → 存入笔记本) belongs to the conversation and is registered independently of the notebook surface.

## Reference authority

Other domains never copy a Note. They store only their own nullable note id, and
validate it against one tiny Cordis service this plugin publishes:

```js
ctx.reflect.provide("acksNotebook", Object.freeze({ existsNote(id) }))
```

`existsNote` answers one question — does this lowercase canonical UUID name a
stored note — and nothing else. There is deliberately no getter and no list:
either would let another domain duplicate a title or Markdown body and drift from
this authority. A conversation import derives a version-5 id by hash, so the
accepted shape is versions 1-5 rather than version 4 alone.

Unlike the archive-only domains, Notebook still **deletes** notes. A reference is
therefore validated when it is written, and a consumer must render a
later-deleted note as safe missing-reference text rather than assume the id
resolves forever.

Notebook is also a consumer. A note carries two independent nullable references —
`projectId` validated through `acksProjects`, and `areaId` validated through
`acksAreas`. Neither implies the other, and each authority is optional on its
own.

A **content version is a snapshot of authorship**. Filing a note under a Project
or an Area is metadata, so a link-only change writes no version. Every field is
validated before the first write, so a rejected edit cannot bank an orphan
version for a note that never changed.

In the browser the editor offers a Project selector and an Area selector beside
the notebook selector, and a note card states its resolved references as text. A
reference that no longer resolves is named plainly rather than dropped, so a note
never looks unfiled just because its owner is unreachable. Each owner is read
independently, so one outage warns beside its own selector only.

## Safety limits

- `POST`, `PUT`, `PATCH` and `DELETE` are rejected with `403` before parsing or routing unless the request is same-origin. `Sec-Fetch-Site` is authoritative when present (`same-origin`/`none` pass); otherwise a present `Origin` must agree with `Host`. Reads stay available because no `Access-Control-Allow-Origin` header is ever sent, so a cross-origin caller cannot read the response.
- Mutation routes accept only `application/json` and reject request bodies above 1 MiB.
- Titles, names, search queries, note content, colors, IDs, category references and tag references are validated on the host.
- Markdown preview uses DSH's React renderer: raw HTML is inert text, unsafe URL protocols are rejected, and images require absolute HTTP(S) URLs. The editor's explicit underline syntax is converted to escaped TeX only for preview.
- Imported DSH message identities are bounded and allowlisted. Their deterministic UUID makes repeated or concurrent capture idempotent.
- Version history is capped at 50 snapshots per note.
- REST responses are same-origin only, disable caching, and do not expose internal exception messages.

## Install

```bash
# from the plugin directory
dsh plugin --profile web add .
# then restart the web profile (command line, or the "Restart Web" button in Settings → General)
```

Manual linking (no pnpm):

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-notebook"
# then add "dsh-notebook": "file:/absolute/path/dsh-notebook" to package.json dependencies,
# add "dsh-notebook" to dsh.profile.bundles, and restart.
```

Before enabling it in a live profile, run:

```bash
node --check lib/index.js
node --check lib/client.js
npm test
```

The package patch can be quarantined without deleting data by setting
`disabled: true` on its `dsh-notebook` entry and restarting the profile.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notebook/state` | Full snapshot `{categories, notes, tags}` |
| POST / PATCH / DELETE | `/api/notebook/categories[/:id]` | Notebook CRUD |
| POST / PATCH / DELETE | `/api/notebook/notes[/:id]` | Note CRUD |
| GET | `/api/notebook/notes/:id/versions` | Version history |
| POST / DELETE | `/api/notebook/tags[/:id]` | Tag CRUD |
| GET | `/api/notebook/search?q=` | Title/content substring search |
