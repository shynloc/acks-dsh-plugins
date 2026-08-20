# Raster asset manifest

Visual source of truth: `design-source/hardware-console-selected-v1.png`.
The console image is not shipped as a clickable page background. The runtime
uses a blank chassis plus separate raster parts attached to native DSH DOM.

| Runtime asset | Native surface | States |
| --- | --- | --- |
| `console-chassis-static.webp` | Non-interactive desktop enclosure and empty wells | static |
| `mobile-pda-branded.webp` | Non-interactive portrait PDA enclosure | static |
| `session-cartridge-up.webp` | Session tree item | raised |
| `session-cartridge-active.webp` | Selected session tree item | pressed with green LED |
| `deck-key-up.webp` | Six sidebar/workspace actions | raised |
| `deck-key-down-v2.webp` | Six sidebar/workspace actions | pressed/open |
| `composer-key-up.webp` | Composer tools and compact native buttons | raised |
| `composer-key-down.webp` | Composer tools and compact native buttons | pressed/selected |
| `model-selector-up.webp` | Native model trigger | raised |
| `model-selector-down-v2.webp` | Native model trigger | pressed/open |
| `send-key-up.webp` | Native send/stop action | raised |
| `send-key-down.webp` | Native send/stop action | pressed |
| `approval-card-frame.webp` | Agent approval takeover | waiting/busy content shell |
| `question-card-frame.webp` | Native user-question flow | options/custom/pager shell |
| `plan-card-frame.webp` | Native plan-review flow | discuss/decline/approve shell |
| `menu-panel.webp` | Menu, command listbox and context panel | open shell |
| `modal-panel.webp` | Shared modal and risk confirmation | open shell |
| `modal-panel-frame.webp` | Shared modal foreground hardware frame | transparent LCD cutout; pointer-transparent overlay |
| `toast-panel.webp` | Shared toast/alert | timed status shell |

The `*-source.png` files are ImageGen masters on a removable chroma-key
background. The sibling PNG files carry the alpha matte used to produce the
cropped runtime WebP files. Rejected first attempts remain for audit but are
not served or referenced by the plugin.
