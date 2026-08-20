# dsh-card-printer

A native, entirely offline card studio: bounded text cards with a finite
palette, an SVG preview and a local Canvas export.

## What this is not

No iframe. No embedded or copied web page. No remote asset, font URL,
background URL, analytics call, model call or network request of any kind. No
arbitrary HTML and no user-supplied CSS.

## Research notes — the user's Wordcard project

The layout and export approach was studied from the user's private `wordcard`
repository (`render-card.js` and `index.html`), read through the user's own
authenticated `gh`. **That project was not modified, deployed or vendored, and
none of its code was copied here.** What follows is what was learned and what
was deliberately rejected.

### Adopted ideas

- **Aspect-ratio presets rather than free-form pixel sizes.** A card is one of a
  few known shapes, which keeps the output coordinate system predictable.
- **Canvas `fillText` + `measureText` for text layout and export.** This is the
  important one. Wordcard draws every glyph itself rather than rasterising
  markup, so no serialized HTML ever reaches the image. This plugin follows the
  same rule, which is what makes an export safe: there is no path by which user
  text becomes markup.
- **A named theme table with explicit colour roles** (background, accent, text)
  instead of free-form colour input.
- **An export scale multiplier** for a high-DPI raster without changing the
  authored coordinate system.

### Rejected patterns

- **Google Fonts loaded from `fonts.googleapis.com`.** A remote asset, and this
  plugin must work offline. Cards render in a local font stack only.
- **`innerHTML` for building controls.** An unsafe sink; every node here is a
  React element.
- **Headless-Chromium rendering through a Node CLI that writes into an `output/`
  directory.** That is a browser launch plus a filesystem write, neither of
  which belongs in a DSH plugin. Export happens in the user's own browser and is
  handed to them, never written server-side.
- **Thirty themes times thirty decorations times thirty dividers.** An unbounded
  combinatorial surface. This plugin ships a small finite palette enum, which is
  what keeps the stored draft validatable.
- **`file://` page loading.** Nothing here resolves a path or a URL.

## The frozen draft contract

One versioned draft, and named presets, are the only things persisted:

```js
{
  version,              // schema version, so a later shape can migrate safely
  title,                // 0..120 code points
  body,                 // 0..2000 code points
  footer,               // 0..80 code points
  preset,               // square | portrait | landscape
  palette,              // ink | sand | forest | dusk | mono
  align,                // left | center
  titleSize,            // bounded integer
  bodySize,             // bounded integer
  padding               // bounded integer
}
```

There is deliberately no font URL, background URL, colour string, CSS field or
HTML field. Every visual choice is an enum or a bounded number, so a stored
draft can be fully validated by the host and can never carry markup.

## Storage

One bounded draft and a small set of named presets in
`$DSH_HOME/storages/card-printer.json`, behind the same origin, content-type and
body-size guards as every other host in this repository.
