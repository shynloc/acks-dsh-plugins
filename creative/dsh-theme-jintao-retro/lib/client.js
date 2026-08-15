/**
 * Component-asset Jintao Retro skin for DeepSeek Harness 0.1.0-rc.6.
 *
 * The enclosure is a static layer. Every interactive part is painted on the
 * original DSH DOM node and therefore retains its native events, focus order,
 * accessibility state and projection-backed behavior.
 */
window.__ModuleLoader__.load({
  id: 'dsh-theme-jintao-retro',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports

    var SOURCE = 'dsh-theme-jintao-retro'
    var BODY_CLASS = 'jintao-retro-theme'
    var DESKTOP_CLASS = 'jintao-retro-desktop'
    var MOBILE_CLASS = 'jintao-retro-mobile'
    var STYLE_ID = 'dsh-theme-jintao-retro-style'
    var ASSET_ROOT = '/jintao-retro-assets'
    var DESKTOP_WIDTH = 1483
    var DESKTOP_HEIGHT = 1061
    var MOBILE_WIDTH = 729
    var MOBILE_HEIGHT = 1578

    function modes(value) {
      return { light: value, dark: value }
    }

    var TOKENS = {
      '--dsw-alias-bg-base': modes('#c9c0ad'),
      '--dsw-alias-bg-layer-1': modes('#d8e3bd'),
      '--dsw-alias-bg-layer-2': modes('#e8dfce'),
      '--dsw-alias-bg-layer-3': modes('#f4efe5'),
      '--dsw-alias-bg-overlay': modes('#c8d1ad'),
      '--dsw-alias-bg-module-platform': modes('#cbd6af'),
      '--dsw-alias-bg-multi-select': modes('#c3cea6'),
      '--dsw-alias-bg-skeleton': modes('#c9d3ae'),
      '--dsw-alias-border-l1': modes('rgba(39,45,39,.16)'),
      '--dsw-alias-border-l2': modes('rgba(39,45,39,.28)'),
      '--dsw-alias-border-l2-darkmode-thin': modes('rgba(39,45,39,.32)'),
      '--dsw-alias-border-l3': modes('rgba(39,45,39,.44)'),
      '--dsw-alias-border-l4': modes('rgba(39,45,39,.58)'),
      '--dsw-alias-border-inverted': modes('#303630'),
      '--dsw-alias-label-primary': modes('#293029'),
      '--dsw-alias-label-primary-bluish': modes('#293029'),
      '--dsw-alias-label-primary-dimmed': modes('#424a42'),
      '--dsw-alias-label-secondary': modes('#4d574e'),
      '--dsw-alias-label-tertiary': modes('#667066'),
      '--dsw-alias-label-caption': modes('#788176'),
      '--dsw-alias-label-dimmed': modes('#8a9084'),
      '--dsw-alias-label-primary-inverted': modes('#f7f4ec'),
      '--dsw-alias-label-primary-foreground': modes('#f7f4ec'),
      '--dsw-alias-brand-primary': modes('#183d34'),
      '--dsw-alias-brand-primary-invert': modes('#f7f4ec'),
      '--dsw-alias-brand-text': modes('#183d34'),
      '--dsw-alias-state-business-primary': modes('#155e75'),
      '--dsw-alias-state-business-tertiary': modes('#bfd3d3'),
      '--dsw-alias-state-success-primary': modes('#19704b'),
      '--dsw-alias-state-success-secondary': modes('#2d8a61'),
      '--dsw-alias-state-success-tertiary': modes('#c5dcc7'),
      '--dsw-alias-state-warn-primary': modes('#946200'),
      '--dsw-alias-state-warn-secondary': modes('#b77b20'),
      '--dsw-alias-state-warn-tertiary': modes('#e8d8ad'),
      '--dsw-alias-state-warn-label': modes('#ffd77a'),
      '--dsw-alias-state-error-primary': modes('#9e3d32'),
      '--dsw-alias-state-error-secondary': modes('#b85a4d'),
      '--dsw-alias-interactive-bg-hover': modes('rgba(24,61,52,.08)'),
      '--dsw-alias-interactive-bg-active': modes('rgba(24,61,52,.14)'),
      '--dsw-alias-interactive-bg-hover-solid': modes('#d2dcb8'),
      '--dsw-alias-interactive-bg-hover-accent': modes('rgba(240,120,40,.14)'),
      '--dsw-alias-interactive-bg-hover-danger': modes('rgba(158,61,50,.12)'),
      '--dsw-alias-button-primary-fill': modes('#183d34'),
      '--dsw-alias-button-primary-hover': modes('#205449'),
      '--dsw-alias-button-primary-dimmed': modes('#668179'),
      '--dsw-alias-button-contrast-fill': modes('#26372f'),
      '--dsw-alias-button-info-fill': modes('#183d34'),
      '--dsw-alias-button-info-hover': modes('#205449'),
      '--dsw-alias-button-elevated-fill': modes('#eee6d5'),
      '--dsw-alias-button-floating-fill': modes('#eee6d5'),
      '--dsw-alias-button-floating-hover': modes('#ded2ba'),
      '--dsw-alias-button-tool-bar-fill': modes('#e9e0ce'),
      '--dsw-alias-button-tool-bar-hover': modes('#d8cdb7'),
      '--dsw-alias-markdown-code-block': modes('#c9d5ae'),
      '--dsw-alias-markdown-code-block-banner': modes('#becba1'),
      '--dsw-alias-markdown-inline-code': modes('#c5d1a9'),
      '--dsw-alias-markdown-citation': modes('#7f8a71'),
      '--dsw-alias-scrollbar-bg-l1': modes('rgba(45,51,46,.24)'),
      '--dsw-alias-scrollbar-bg-l2': modes('rgba(45,51,46,.32)'),
      '--dsw-alias-scrollbar-hover-l1': modes('rgba(45,51,46,.42)'),
      '--dsw-alias-scrollbar-hover-l2': modes('rgba(45,51,46,.52)'),
      '--dsw-alias-tooltip-bg': modes('#293029'),
      '--dsw-alias-toast-bg': modes('#f7f4ec'),
      '--dsw-specific-sidebar-fill': modes('transparent'),
      '--dsw-specific-sidebar-nav-item-active': modes('transparent'),
      '--dsw-specific-sidebar-nav-item-active-accent': modes('#183d34'),
      '--dsw-specific-sidebar-nav-item-hover': modes('transparent'),
      '--dsw-specific-input-major': modes('transparent'),
      '--dsw-specific-selector': modes('#ddd1ba'),
      '--dsw-specific-bubble': modes('rgba(204,216,177,.34)'),
      '--dsw-specific-bubble-highlight': modes('#c2d0a4'),
      '--dsw-specific-menu': modes('#d8e3bd'),
      '--dsw-specific-tip': modes('#eee5d3')
    }

    var STYLE_TEXT = String.raw`
body.jintao-retro-theme {
  --jrt-chassis: url('${ASSET_ROOT}/console-chassis-static.webp');
  --jrt-pda: url('${ASSET_ROOT}/mobile-pda-branded.webp');
  --jrt-session-up: url('${ASSET_ROOT}/session-cartridge-up.webp');
  --jrt-session-active: url('${ASSET_ROOT}/session-cartridge-active.webp');
  --jrt-deck-up: url('${ASSET_ROOT}/deck-key-up.webp');
  --jrt-deck-down: url('${ASSET_ROOT}/deck-key-down-v2.webp');
  --jrt-small-up: url('${ASSET_ROOT}/composer-key-up.webp');
  --jrt-small-down: url('${ASSET_ROOT}/composer-key-down.webp');
  --jrt-selector-up: url('${ASSET_ROOT}/model-selector-up.webp');
  --jrt-selector-down: url('${ASSET_ROOT}/model-selector-down-v2.webp');
  --jrt-send-up: url('${ASSET_ROOT}/send-key-up.webp');
  --jrt-send-down: url('${ASSET_ROOT}/send-key-down.webp');
  --jrt-approval: url('${ASSET_ROOT}/approval-card-frame.webp');
  --jrt-question: url('${ASSET_ROOT}/question-card-frame.webp');
  --jrt-plan: url('${ASSET_ROOT}/plan-card-frame.webp');
  --jrt-modal: url('${ASSET_ROOT}/modal-panel.webp');
  --jrt-modal-frame: url('${ASSET_ROOT}/modal-panel-frame.webp');
  --jrt-menu: url('${ASSET_ROOT}/menu-panel.webp');
  --jrt-toast: url('${ASSET_ROOT}/toast-panel.webp');
  --jrt-ink: #293029;
  --jrt-screen: #d8e3bd;
  --jrt-green: #183d34;
  margin: 0;
  overflow: hidden;
  background: #bdb29f;
  color: var(--jrt-ink);
  font-family: 'Cascadia Mono','JetBrains Mono','Noto Sans Mono CJK SC',ui-monospace,monospace;
}

body.jintao-retro-theme :where(button,input,textarea,select) { font-family: inherit; }

body.jintao-retro-theme [data-slot='root'] {
  display: block !important;
  position: fixed !important;
  z-index: 0;
  top: 50%;
  left: 50%;
  box-sizing: border-box;
  width: 1483px;
  height: 1061px;
  overflow: hidden;
  background-color: transparent !important;
  background-image: var(--jrt-chassis) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  transform: translate(-50%,-50%) scale(var(--jrt-stage-scale,1));
  transform-origin: center;
  isolation: isolate;
}

body.jintao-retro-theme [data-slot='root'] > [class*='_frame'] {
  position: absolute !important;
  inset: 0 !important;
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  overflow: visible !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* Desktop enclosure apertures. */
body.jintao-retro-theme.jintao-retro-desktop [class*='_sidebarCol'] {
  position: absolute !important;
  z-index: 5;
  top: 0 !important;
  left: 0 !important;
  width: 400px !important;
  height: 760px !important;
  overflow: visible !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

body.jintao-retro-theme.jintao-retro-desktop [class*='_centerCol'] {
  position: absolute !important;
  z-index: 2;
  inset: 0 !important;
  width: 1483px !important;
  height: 1061px !important;
  min-width: 0 !important;
  overflow: visible !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

body.jintao-retro-theme [class*='_detailsCol'] { display: none !important; }

body.jintao-retro-theme.jintao-retro-desktop [data-slot='sidebar'],
body.jintao-retro-theme.jintao-retro-desktop [data-slot='sidebar'] > [class*='_root'],
body.jintao-retro-theme.jintao-retro-desktop [class*='_regionArea'],
body.jintao-retro-theme.jintao-retro-desktop [class*='_listArea'],
body.jintao-retro-theme.jintao-retro-desktop [class*='_treeBody'] {
  position: static !important;
  width: auto !important;
  height: auto !important;
  overflow: visible !important;
  background: transparent !important;
}

body.jintao-retro-theme.jintao-retro-desktop [class*='_logoRow'],
body.jintao-retro-theme.jintao-retro-desktop [class*='_sectionHeader'],
body.jintao-retro-theme.jintao-retro-desktop [class*='_footArea'],
body.jintao-retro-theme.jintao-retro-desktop [class*='_settingsArea'] {
  overflow: visible !important;
  pointer-events: none;
}

body.jintao-retro-theme.jintao-retro-desktop [class*='_logoRow'] > *,
body.jintao-retro-theme.jintao-retro-desktop [class*='_sectionHeader'] > *,
body.jintao-retro-theme.jintao-retro-desktop [class*='_footArea'] > * { pointer-events: auto; }

/* The chassis already carries its own brand and section engraving. Keep the
   real controls, but suppress duplicate native labels that would float above it. */
body.jintao-retro-theme.jintao-retro-desktop [class*='_logoRow'] > :not(button) {
  visibility: hidden !important;
}
body.jintao-retro-theme.jintao-retro-desktop [class*='_logoRow'] > button[class*='_brand'] {
  display: none !important;
}
body.jintao-retro-theme.jintao-retro-desktop [class*='_sectionHeader'] {
  color: transparent !important;
  font-size: 0 !important;
}

body.jintao-retro-theme.jintao-retro-desktop [role='tree'] {
  position: fixed !important;
  z-index: 8;
  top: 82px !important;
  left: 44px !important;
  box-sizing: border-box;
  width: 334px !important;
  height: 650px !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-width: none;
  background: transparent !important;
}

body.jintao-retro-theme.jintao-retro-desktop [role='tree']::-webkit-scrollbar { display: none; }
body.jintao-retro-theme [role='treeitem'][aria-expanded] { display: none !important; }
body.jintao-retro-theme.jintao-retro-desktop [role='tree']
  :where(button,[role='treeitem']):not([data-jrt-role='session']) {
  display: none !important;
}

body.jintao-retro-theme.jintao-retro-desktop [data-jrt-role='session'] {
  position: relative !important;
  box-sizing: border-box;
  display: flex !important;
  align-items: center !important;
  width: 326px !important;
  height: 74px !important;
  min-height: 74px !important;
  margin: 0 0 6px !important;
  padding: 0 66px 0 46px !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: none !important;
  background-color: transparent !important;
  background-image: var(--jrt-session-up) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  box-shadow: none !important;
  color: var(--jrt-ink) !important;
  transform: translateY(0);
  transition: filter 80ms ease,transform 70ms ease;
}

body.jintao-retro-theme [data-jrt-role='session'][aria-selected='true'],
body.jintao-retro-theme [data-jrt-role='session']:active {
  background-image: var(--jrt-session-active) !important;
  transform: translateY(2px);
}

body.jintao-retro-theme [data-jrt-role='session']:hover { filter: brightness(1.035); }
body.jintao-retro-theme [data-jrt-role='session']:focus-visible { filter: drop-shadow(0 0 5px #f2a43a); }
body.jintao-retro-theme [data-jrt-role='session'] [class*='_time'],
body.jintao-retro-theme [data-jrt-role='session'] [class*='_rowActions'],
body.jintao-retro-theme [data-jrt-role='session'] > [class*='_slot'] { display: none !important; }
body.jintao-retro-theme [data-jrt-role='session'] [class*='_title'] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: inherit !important;
  font-size: 13px !important;
  font-weight: 650;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Six actual sidebar/workspace controls become the six large deck keys. */
body.jintao-retro-theme.jintao-retro-desktop [data-jrt-role='deck-key'] {
  position: fixed !important;
  z-index: 40 !important;
  top: calc(790px + (var(--jrt-row) * 112px)) !important;
  left: calc(30px + (var(--jrt-col) * 130px)) !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 5px !important;
  box-sizing: border-box !important;
  width: 118px !important;
  height: 106px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 17px 12px 10px !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background-color: transparent !important;
  background-image: var(--jrt-deck-up) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  box-shadow: none !important;
  color: var(--jrt-ink) !important;
  font-size: 0 !important;
  cursor: pointer;
}

body.jintao-retro-theme [data-jrt-role='deck-key']::after {
  content: attr(aria-label);
  display: block;
  max-width: 88px;
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  line-height: 16px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

body.jintao-retro-theme [data-jrt-role='deck-key'] svg { width: 18px !important; height: 18px !important; }
body.jintao-retro-theme [data-jrt-role='deck-key'] span { font-size: 0 !important; }
body.jintao-retro-theme [data-jrt-role='deck-key']:active,
body.jintao-retro-theme [data-jrt-role='deck-key'][aria-expanded='true'] {
  padding-top: 20px !important;
  background-image: var(--jrt-deck-down) !important;
}
body.jintao-retro-theme [data-jrt-role='deck-key']:focus-visible { filter: drop-shadow(0 0 6px #f2a43a); }
body.jintao-retro-theme [data-jrt-role='deck-key']:disabled { filter: grayscale(.65); opacity: .58; }

/* The live conversation stays inside the CRT aperture. */
body.jintao-retro-theme.jintao-retro-desktop [data-slot='conversation'],
body.jintao-retro-theme.jintao-retro-desktop [data-slot='conversation'] > [class*='_root'] {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  overflow: visible !important;
  background: transparent !important;
}

body.jintao-retro-theme.jintao-retro-desktop [class*='_centerCol']
  [class*='_header']:has(> [class*='_titleRow']) {
  position: fixed !important;
  z-index: 12;
  top: 88px !important;
  left: 445px !important;
  box-sizing: border-box;
  width: 950px !important;
  height: 64px !important;
  min-height: 0 !important;
  padding: 4px 12px 0 !important;
  overflow: hidden !important;
  border-bottom: 1px solid rgba(41,48,41,.25) !important;
  background: transparent !important;
  box-shadow: none !important;
}

body.jintao-retro-theme.jintao-retro-desktop [data-conversation-scroll] {
  position: fixed !important;
  z-index: 8;
  top: 153px !important;
  left: 438px !important;
  box-sizing: border-box;
  width: 965px !important;
  height: 557px !important;
  min-height: 0 !important;
  padding: 0 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  background: transparent !important;
  scrollbar-gutter: stable;
}

body.jintao-retro-theme [data-conversation-scroll] [class*='_scroll'] { padding: 12px 18px 24px !important; }
body.jintao-retro-theme [data-conversation-scroll] [class*='_column'] { width: 100% !important; max-width: none !important; margin: 0 !important; }
body.jintao-retro-theme [data-conversation-scroll] [class*='_flowItem'] {
  padding: 11px 2px !important;
  border-top: 1px dashed rgba(41,48,41,.25);
  font-size: 13px !important;
  line-height: 1.55 !important;
}
body.jintao-retro-theme [data-conversation-scroll] [class*='_flowItem']:first-child { border-top: 0; }
body.jintao-retro-theme [data-conversation-scroll] [class*='_bubble'] {
  max-width: none !important;
  border-radius: 2px !important;
  background: rgba(24,61,52,.045) !important;
  box-shadow: none !important;
}
body.jintao-retro-theme :where(pre,code,kbd,samp) { font-family: inherit !important; }
body.jintao-retro-theme pre { border: 1px solid rgba(41,48,41,.32) !important; border-radius: 2px !important; }

/* Composer glass and its native controls. */
body.jintao-retro-theme.jintao-retro-desktop [class*='_composerSeat'] {
  position: fixed !important;
  z-index: 30 !important;
  top: 792px !important;
  left: 450px !important;
  display: block !important;
  width: 650px !important;
  height: 250px !important;
  min-height: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  background: transparent !important;
  box-shadow: none !important;
}

body.jintao-retro-theme [class*='_composerSeat'] [class*='_composerStack'],
body.jintao-retro-theme [class*='_composerSeat'] [data-slot='conversation.composer.bar'],
body.jintao-retro-theme [class*='_composerSeat'] [data-slot='conversation.composer.bar'] > [class*='_root'] {
  position: static !important;
  width: auto !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  background: transparent !important;
}

body.jintao-retro-theme.jintao-retro-desktop [data-composer-card] {
  position: absolute !important;
  inset: 0 !important;
  width: 650px !important;
  height: 250px !important;
  min-height: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

body.jintao-retro-theme.jintao-retro-desktop [data-composer-card] [data-input-scroll] {
  position: absolute !important;
  top: 18px !important;
  left: 18px !important;
  box-sizing: border-box;
  width: 615px !important;
  height: 128px !important;
  max-height: 128px !important;
  padding: 0 !important;
  overflow-y: auto !important;
}

body.jintao-retro-theme [data-composer-card] :where(textarea,[data-input-backdrop],[data-input-mirror]) {
  color: var(--jrt-ink) !important;
  font-size: 13px !important;
  line-height: 1.55 !important;
  background: transparent !important;
}

body.jintao-retro-theme.jintao-retro-desktop [data-composer-card] [class*='_row'],
body.jintao-retro-theme.jintao-retro-desktop [data-composer-card] [class*='_tools'],
body.jintao-retro-theme.jintao-retro-desktop [data-composer-card] [class*='_trailing'],
body.jintao-retro-theme.jintao-retro-desktop [data-composer-card] [class*='_modes'] { display: contents !important; }

body.jintao-retro-theme.jintao-retro-desktop [data-jrt-role='composer-key'] {
  position: fixed !important;
  z-index: 44 !important;
  top: 980px !important;
  left: calc(450px + (var(--jrt-small-slot) * 130px)) !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  box-sizing: border-box !important;
  width: 120px !important;
  height: 54px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 12px 11px 7px !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background-color: transparent !important;
  background-image: var(--jrt-small-up) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  box-shadow: none !important;
  color: var(--jrt-ink) !important;
  font-size: 11px !important;
  line-height: 14px !important;
}

body.jintao-retro-theme [data-jrt-role='composer-key']:active,
body.jintao-retro-theme [data-jrt-role='composer-key'][aria-expanded='true'],
body.jintao-retro-theme [data-jrt-role='composer-key'][aria-checked='true'] {
  padding-top: 15px !important;
  background-image: var(--jrt-small-down) !important;
}
body.jintao-retro-theme [data-jrt-role='composer-key']:focus-visible { filter: drop-shadow(0 0 5px #f2a43a); }
body.jintao-retro-theme [data-jrt-role='composer-key']:disabled { filter: grayscale(.65); opacity: .55; }
body.jintao-retro-theme [data-jrt-role='composer-key'] svg { width: 15px !important; height: 15px !important; flex: none; }

body.jintao-retro-theme.jintao-retro-desktop [data-jrt-role='model-root'] {
  position: fixed !important;
  z-index: 45 !important;
  top: 842px !important;
  left: 1137px !important;
  width: 174px !important;
  height: 66px !important;
  overflow: visible !important;
}

body.jintao-retro-theme [data-jrt-role='model-trigger'] {
  position: absolute !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 5px !important;
  box-sizing: border-box !important;
  width: 174px !important;
  height: 66px !important;
  min-width: 0 !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 12px 36px 9px 16px !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background-color: transparent !important;
  background-image: var(--jrt-selector-up) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  box-shadow: none !important;
  color: var(--jrt-ink) !important;
  font-size: 11px !important;
}

body.jintao-retro-theme [data-jrt-role='model-trigger'][aria-expanded='true'],
body.jintao-retro-theme [data-jrt-role='model-trigger']:active {
  padding-top: 15px !important;
  background-image: var(--jrt-selector-down) !important;
}
body.jintao-retro-theme [data-jrt-role='model-trigger']:focus-visible { filter: drop-shadow(0 0 5px #f2a43a); }

body.jintao-retro-theme.jintao-retro-desktop [data-jrt-role='send-key'] {
  position: fixed !important;
  z-index: 46 !important;
  top: 830px !important;
  left: 1324px !important;
  display: grid !important;
  place-items: center !important;
  width: 104px !important;
  height: 104px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 0 4px !important;
  overflow: visible !important;
  border: 0 !important;
  border-radius: 50% !important;
  outline: 0 !important;
  background-color: transparent !important;
  background-image: var(--jrt-send-up) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  box-shadow: none !important;
  color: #f4f0e7 !important;
}
body.jintao-retro-theme [data-jrt-role='send-key']:active { padding-top: 5px !important; background-image: var(--jrt-send-down) !important; }
body.jintao-retro-theme [data-jrt-role='send-key']:focus-visible { filter: drop-shadow(0 0 7px #f2a43a); }
body.jintao-retro-theme [data-jrt-role='send-key']:disabled { filter: grayscale(.75); opacity: .55; }
body.jintao-retro-theme [data-jrt-role='send-key'] svg { width: 27px !important; height: 27px !important; }

/* Real composer takeovers: approval, questions and plan review. */
body.jintao-retro-theme [data-approval-key],
body.jintao-retro-theme [data-question-key],
body.jintao-retro-theme [data-plan-review-key] {
  position: fixed !important;
  z-index: 120 !important;
  top: 485px !important;
  left: 510px !important;
  width: 820px !important;
  max-height: 400px !important;
  overflow: visible !important;
}

body.jintao-retro-theme [data-approval-key] > *,
body.jintao-retro-theme [data-question-key] > *,
body.jintao-retro-theme [data-plan-review-key] > * {
  box-sizing: border-box !important;
  width: 100% !important;
  max-height: 400px !important;
  margin: 0 !important;
  overflow: hidden !important;
  border: 36px solid transparent !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  box-shadow: none !important;
}
body.jintao-retro-theme [data-approval-key] > * { border-image: var(--jrt-approval) 115 fill / 36px / 0 stretch !important; }
body.jintao-retro-theme [data-question-key] > * { border-image: var(--jrt-question) 125 fill / 36px / 0 stretch !important; }
body.jintao-retro-theme [data-plan-review-key] > * { border-image: var(--jrt-plan) 120 fill / 36px / 0 stretch !important; }
body.jintao-retro-theme :where([data-approval-scroll],[data-question-scroll],[data-plan-review-scroll]) {
  min-height: 0 !important;
  max-height: 245px !important;
  overflow-y: auto !important;
  color: var(--jrt-ink) !important;
}
body.jintao-retro-theme :where([data-approval-key],[data-question-key],[data-plan-review-key]) button {
  min-height: 42px !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background-color: transparent !important;
  background-image: var(--jrt-small-up) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  box-shadow: none !important;
  color: var(--jrt-ink) !important;
}
body.jintao-retro-theme :where([data-approval-key],[data-question-key],[data-plan-review-key]) button:active,
body.jintao-retro-theme [data-question-key] button[aria-checked='true'] {
  padding-top: 4px !important;
  background-image: var(--jrt-small-down) !important;
}
body.jintao-retro-theme [data-question-key] button[role='radio'],
body.jintao-retro-theme [data-question-key] button[role='checkbox'] {
  width: 100% !important;
  padding: 12px 18px !important;
  text-align: left !important;
}

/* Native menus, model/command lists, modals and notices get their own shells. */
body.jintao-retro-theme [data-jrt-role='menu-panel'] {
  z-index: 500 !important;
  box-sizing: border-box !important;
  min-width: 240px !important;
  max-width: 430px !important;
  max-height: 430px !important;
  padding: 22px !important;
  overflow-y: auto !important;
  border: 24px solid transparent !important;
  border-radius: 0 !important;
  border-image: var(--jrt-menu) 150 fill / 24px / 0 stretch !important;
  background-color: transparent !important;
  box-shadow: none !important;
  color: var(--jrt-ink) !important;
}
body.jintao-retro-theme.jintao-retro-desktop [data-jrt-role='menu-panel'] {
  position: fixed !important;
  top: auto !important;
  right: 165px !important;
  bottom: 126px !important;
  left: auto !important;
}
body.jintao-retro-theme [data-jrt-role='menu-panel'] :where(button,[role='option'],[role='menuitem'],[role='menuitemradio']) {
  min-height: 38px !important;
  margin: 2px 0 !important;
  padding: 8px 12px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  background-image: var(--jrt-small-up) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  color: var(--jrt-ink) !important;
}
body.jintao-retro-theme [data-jrt-role='menu-panel'] :where(button,[role='option'],[role='menuitem'],[role='menuitemradio']):active,
body.jintao-retro-theme [data-jrt-role='menu-panel'] :where([aria-selected='true'],[aria-checked='true']) {
  background-image: var(--jrt-small-down) !important;
}

body.jintao-retro-theme [data-jrt-role='dialog-panel'] {
  position: fixed !important;
  z-index: 2000 !important;
  isolation: isolate;
  box-sizing: border-box !important;
  width: 720px !important;
  height: 880px !important;
  max-width: min(720px,calc(100vw - 48px)) !important;
  max-height: min(880px,calc(100vh - 48px)) !important;
  padding: 128px 72px 92px !important;
  overflow-y: auto !important;
  border: 0 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  background-image: var(--jrt-modal) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  box-shadow: none !important;
  color: var(--jrt-ink) !important;
}
body.jintao-retro-theme [data-jrt-role='dialog-panel'] > * {
  position: relative;
  z-index: 1;
}
body.jintao-retro-theme [data-jrt-role='dialog-panel']::after {
  content: '';
  position: absolute;
  z-index: 10;
  inset: 0;
  pointer-events: none;
  background: var(--jrt-modal-frame) center / 100% 100% no-repeat;
}
body.jintao-retro-theme [data-jrt-role='dialog-panel'] button {
  min-height: 42px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: var(--jrt-small-up) center/100% 100% no-repeat !important;
  color: var(--jrt-ink) !important;
}
body.jintao-retro-theme [data-jrt-role='dialog-panel'] button:active { background-image: var(--jrt-small-down) !important; }

body.jintao-retro-theme [data-jrt-role='toast-panel'] {
  box-sizing: border-box !important;
  min-width: 320px !important;
  min-height: 62px !important;
  padding: 18px 32px 18px 60px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
  background-image: var(--jrt-toast) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: 100% 100% !important;
  box-shadow: none !important;
  color: #f5f0df !important;
}

/* Portrait PDA: the hardware is static, all LCD controls are still native. */
body.jintao-retro-theme.jintao-retro-mobile { background: #090b0a; }
body.jintao-retro-theme.jintao-retro-mobile [data-slot='root'] {
  width: 729px !important;
  height: 1578px !important;
  background-image: var(--jrt-pda) !important;
  background-size: 103% 100% !important;
  background-position: center !important;
}
body.jintao-retro-theme.jintao-retro-mobile [class*='_sidebarCol'] { display: none !important; }
body.jintao-retro-theme.jintao-retro-mobile [class*='_centerCol'] {
  position: absolute !important;
  inset: 0 !important;
  display: block !important;
  width: 729px !important;
  height: 1578px !important;
  overflow: visible !important;
  background: transparent !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-slot='conversation'],
body.jintao-retro-theme.jintao-retro-mobile [data-slot='conversation'] > [class*='_root'] {
  position: absolute !important;
  inset: 0 !important;
  width: 729px !important;
  height: 1578px !important;
  overflow: visible !important;
  background: transparent !important;
}
body.jintao-retro-theme.jintao-retro-mobile [class*='_centerCol']
  [class*='_header']:has(> [class*='_titleRow']) {
  position: fixed !important;
  z-index: 12;
  top: 250px !important;
  left: 112px !important;
  box-sizing: border-box;
  width: 505px !important;
  height: 82px !important;
  min-height: 0 !important;
  padding: 10px 8px !important;
  overflow: hidden !important;
  border-bottom: 2px solid rgba(27,45,36,.55) !important;
  background: transparent !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-conversation-scroll] {
  position: fixed !important;
  z-index: 8;
  top: 334px !important;
  left: 112px !important;
  box-sizing: border-box;
  width: 505px !important;
  height: 450px !important;
  min-height: 0 !important;
  padding: 0 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  background: transparent !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-conversation-scroll] [class*='_flowItem'] {
  padding: 13px 0 !important;
  font-size: 19px !important;
  line-height: 1.5 !important;
}
body.jintao-retro-theme.jintao-retro-mobile [class*='_composerSeat'] {
  position: fixed !important;
  z-index: 30 !important;
  top: 790px !important;
  left: 112px !important;
  display: block !important;
  width: 505px !important;
  height: 230px !important;
  min-height: 0 !important;
  overflow: visible !important;
  background: transparent !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-composer-card] {
  position: absolute !important;
  inset: 0 !important;
  width: 505px !important;
  height: 230px !important;
  min-height: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  border: 2px solid rgba(27,45,36,.58) !important;
  border-radius: 4px !important;
  background: rgba(216,227,189,.2) !important;
  box-shadow: none !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-composer-card] [data-input-scroll] {
  position: absolute !important;
  top: 10px !important;
  left: 10px !important;
  width: 485px !important;
  height: 112px !important;
  max-height: 112px !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-composer-card] [class*='_row'],
body.jintao-retro-theme.jintao-retro-mobile [data-composer-card] [class*='_tools'],
body.jintao-retro-theme.jintao-retro-mobile [data-composer-card] [class*='_trailing'],
body.jintao-retro-theme.jintao-retro-mobile [data-composer-card] [class*='_modes'] { display: contents !important; }
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='composer-key'] {
  position: fixed !important;
  z-index: 44 !important;
  top: 928px !important;
  left: calc(116px + (var(--jrt-small-slot) * 98px)) !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 3px !important;
  width: 92px !important;
  height: 52px !important;
  min-width: 0 !important;
  padding: 12px 7px 6px !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: var(--jrt-small-up) center/100% 100% no-repeat !important;
  color: var(--jrt-ink) !important;
  font-size: 0 !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='composer-key']:active,
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='composer-key'][aria-expanded='true'] { background-image: var(--jrt-small-down) !important; }
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='composer-key'] svg { width: 21px !important; height: 21px !important; }
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='model-root'] {
  position: fixed !important;
  z-index: 45 !important;
  top: 990px !important;
  left: 116px !important;
  width: 300px !important;
  height: 62px !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='model-trigger'] {
  position: absolute !important;
  inset: 0 !important;
  width: 300px !important;
  height: 62px !important;
  min-width: 0 !important;
  max-width: none !important;
  padding: 12px 50px 8px 18px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: var(--jrt-selector-up) center/100% 100% no-repeat !important;
  color: var(--jrt-ink) !important;
  font-size: 18px !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='send-key'] {
  position: fixed !important;
  z-index: 46 !important;
  top: 980px !important;
  left: 518px !important;
  display: grid !important;
  place-items: center !important;
  width: 86px !important;
  height: 86px !important;
  min-width: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 50% !important;
  background: var(--jrt-send-up) center/100% 100% no-repeat !important;
  color: #f4f0e7 !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-approval-key],
body.jintao-retro-theme.jintao-retro-mobile [data-question-key],
body.jintao-retro-theme.jintao-retro-mobile [data-plan-review-key] {
  position: fixed !important;
  z-index: 150 !important;
  top: 420px !important;
  left: 112px !important;
  width: 505px !important;
  max-height: 520px !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='menu-panel'] {
  position: fixed !important;
  z-index: 500 !important;
  top: auto !important;
  right: 112px !important;
  bottom: 340px !important;
  left: 112px !important;
  width: 505px !important;
  max-width: none !important;
}
body.jintao-retro-theme.jintao-retro-mobile [data-jrt-role='dialog-panel'] {
  width: 577px !important;
  height: 1080px !important;
  max-width: 577px !important;
  max-height: 1080px !important;
  padding: 160px 58px 108px !important;
  font-size: 20px !important;
}

@media (prefers-reduced-motion: reduce) {
  body.jintao-retro-theme * { transition: none !important; animation-duration: .01ms !important; }
}
`

    function installResponsiveStage() {
      var disposed = false
      var queued = false
      var root = null
      var observer = null

      function setClass(name, enabled) {
        if (enabled) document.body.classList.add(name)
        else document.body.classList.remove(name)
      }

      function sync() {
        queued = false
        if (disposed) return
        root = document.querySelector && document.querySelector("[data-slot='root']")
        if (!root) return

        var viewport = window.visualViewport
        var width = viewport ? viewport.width : window.innerWidth
        var height = viewport ? viewport.height : window.innerHeight
        var mobile = width < 760 || height < 620
        var designWidth = mobile ? MOBILE_WIDTH : DESKTOP_WIDTH
        var designHeight = mobile ? MOBILE_HEIGHT : DESKTOP_HEIGHT
        var gutter = mobile ? 0 : 40
        var scale = Math.min((width - gutter) / designWidth, (height - gutter) / designHeight, 1)
        scale = Math.max(.08, scale)

        root.style.setProperty('--jrt-stage-scale', String(scale))
        root.setAttribute('data-jrt-stage', mobile ? 'mobile' : 'desktop')
        setClass(DESKTOP_CLASS, !mobile)
        setClass(MOBILE_CLASS, mobile)
      }

      function schedule() {
        if (queued || disposed) return
        queued = true
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(sync)
        else setTimeout(sync, 0)
      }

      window.addEventListener('resize', schedule)
      if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule)
      if (typeof MutationObserver !== 'undefined' && document.body) {
        observer = new MutationObserver(schedule)
        observer.observe(document.body, { subtree: true, childList: true })
      }
      sync()

      return function () {
        disposed = true
        window.removeEventListener('resize', schedule)
        if (window.visualViewport) window.visualViewport.removeEventListener('resize', schedule)
        if (observer) observer.disconnect()
        setClass(DESKTOP_CLASS, false)
        setClass(MOBILE_CLASS, false)
        if (root) {
          root.style.removeProperty('--jrt-stage-scale')
          root.removeAttribute('data-jrt-stage')
        }
      }
    }

    function installNativeTagging() {
      if (!document.querySelectorAll) return function () {}
      var disposed = false
      var queued = false

      function tag(element, role, slotName, slotValue) {
        if (!element) return
        element.setAttribute('data-jrt-role', role)
        if (slotName) {
          element.style.setProperty(slotName, String(slotValue))
          element.setAttribute('data-jrt-slot', String(slotValue))
        }
      }

      function first(root, selector) {
        return root && root.querySelector ? root.querySelector(selector) : null
      }

      function sync() {
        queued = false
        if (disposed) return

        var sessions = document.querySelectorAll("[role='treeitem'][aria-selected]")
        for (var i = 0; i < sessions.length; i += 1) tag(sessions[i], 'session')

        var sidebar = document.querySelector("[data-slot='sidebar']")
        if (sidebar) {
          tag(first(sidebar, "button[class*='_newSession']"), 'deck-key', '--jrt-col', 0)
          var newKey = first(sidebar, "button[class*='_newSession']")
          if (newKey) newKey.style.setProperty('--jrt-row', '0')
          var toggle = first(sidebar, "button[class*='_toggle']")
          tag(toggle, 'deck-key', '--jrt-col', 1)
          if (toggle) toggle.style.setProperty('--jrt-row', '0')
          var search = first(sidebar, "button[class*='_searchButton']")
          tag(search, 'deck-key', '--jrt-col', 2)
          if (search) search.style.setProperty('--jrt-row', '0')

          var header = first(sidebar, "[class*='_sectionHeader']")
          var headerButtons = header && header.querySelectorAll ? header.querySelectorAll("button[class*='_iconButton']") : []
          if (headerButtons.length > 0) {
            tag(headerButtons[0], 'deck-key', '--jrt-col', 0)
            headerButtons[0].style.setProperty('--jrt-row', '1')
          }
          if (headerButtons.length > 1) {
            tag(headerButtons[1], 'deck-key', '--jrt-col', 1)
            headerButtons[1].style.setProperty('--jrt-row', '1')
          }
          var settings = first(sidebar, "[class*='_settingsArea'] button")
          tag(settings, 'deck-key', '--jrt-col', 2)
          if (settings) settings.style.setProperty('--jrt-row', '1')
        }

        var cards = document.querySelectorAll('[data-composer-card]')
        for (var c = 0; c < cards.length; c += 1) {
          var card = cards[c]
          var addButtons = card.querySelectorAll("button[class*='_add']")
          if (addButtons.length > 0) tag(addButtons[0], 'composer-key', '--jrt-small-slot', 0)
          if (addButtons.length > 1) tag(addButtons[1], 'composer-key', '--jrt-small-slot', 1)

          var tools = first(card, "[class*='_tools']")
          var access = first(tools, "button[class*='_trigger']")
          tag(access, 'composer-key', '--jrt-small-slot', 2)

          var trailing = first(card, "[class*='_trailing']")
          var context = first(trailing, "button[aria-haspopup='dialog']")
          tag(context, 'composer-key', '--jrt-small-slot', 3)
          var plan = first(card, "[data-slot='conversation.input.plan'] button")
          tag(plan, 'composer-key', '--jrt-small-slot', 4)

          var model = first(trailing, "button[aria-haspopup='menu'][class*='_trigger']")
          if (model) {
            tag(model, 'model-trigger')
            tag(model.parentElement, 'model-root')
          }
          var primary = first(trailing, "button[class*='_primary']")
          tag(primary, 'send-key')
        }

        var menus = document.querySelectorAll("[role='menu'],[role='listbox']")
        for (var m = 0; m < menus.length; m += 1) tag(menus[m], 'menu-panel')
        var dialogs = document.querySelectorAll("[role='dialog']")
        for (var d = 0; d < dialogs.length; d += 1) {
          if (dialogs[d].closest && dialogs[d].closest('[data-composer-card]')) tag(dialogs[d], 'menu-panel')
          else tag(dialogs[d], 'dialog-panel')
        }
        var alerts = document.querySelectorAll("[role='alert']")
        for (var a = 0; a < alerts.length; a += 1) tag(alerts[a], 'toast-panel')
      }

      function schedule() {
        if (queued || disposed) return
        queued = true
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(sync)
        else setTimeout(sync, 0)
      }

      var observer = null
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(schedule)
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['aria-selected', 'aria-expanded', 'aria-checked', 'class']
        })
      }
      sync()

      return function () {
        disposed = true
        if (observer) observer.disconnect()
        var tagged = document.querySelectorAll('[data-jrt-role]')
        for (var i = 0; i < tagged.length; i += 1) {
          tagged[i].removeAttribute('data-jrt-role')
          tagged[i].removeAttribute('data-jrt-slot')
          tagged[i].style.removeProperty('--jrt-col')
          tagged[i].style.removeProperty('--jrt-row')
          tagged[i].style.removeProperty('--jrt-small-slot')
        }
      }
    }

    function apply(ctx) {
      var disposeTokens = ctx.theme.overrideTokens(SOURCE, TOKENS)
      ctx.effect(function () { return disposeTokens }, 'dsh-theme-jintao-retro: token layer')

      ctx.effect(function () {
        var body = document.body
        var head = document.head
        if (!body || !head) throw new Error('dsh-theme-jintao-retro requires document.head and document.body')

        var stale = document.getElementById(STYLE_ID)
        if (stale) stale.remove()
        var style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = STYLE_TEXT
        head.appendChild(style)
        body.classList.add(BODY_CLASS)

        var disposeStage = installResponsiveStage()
        var disposeTagging = installNativeTagging()
        return function () {
          disposeTagging()
          disposeStage()
          body.classList.remove(BODY_CLASS)
          if (style.parentNode) style.parentNode.removeChild(style)
        }
      }, 'dsh-theme-jintao-retro: native component asset skin')
    }

    exports.apply = apply
    exports.inject = ['theme']
    return module.exports
  }
})
