// The complete stylesheet for the Wayfinder helper shadow root.
export const helperStyles = `
  :host {
    --wf-ink: #25231f;
    --wf-paper: #fffaf0;
    --wf-gold: #e8a72f;
    --wf-rust: #a94425;
    --wf-moss: #42694f;
    --wf-text-muted: #625b50;
    --wf-surface-panel: #fffaf0;
    --wf-surface-input: #fffef9;
    --wf-surface-card: rgba(255,255,255,.52);
    --wf-surface-moss: rgba(66,105,79,.1);
    --wf-surface-gold: rgba(232,167,47,.12);
    --wf-surface-error: rgba(181,79,44,.09);
    --wf-line: rgba(37, 35, 31, 0.22);
    --wf-focus: #0969da;
    --wf-shadow: rgba(20,18,14,.2);
    --wf-shadow-hard: rgba(37,35,31,.2);
    --wf-warning-text: #62502f;
    --wf-provenance-text: #704500;
    --wf-ping-shadow: rgba(181,79,44,.45);
    all: initial;
    color-scheme: light dark;
    color: var(--wf-ink);
    font-family: Georgia, 'Times New Roman', serif;
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --wf-ink: #f4ead8;
      --wf-paper: #171512;
      --wf-gold: #e8b85a;
      --wf-rust: #f08a63;
      --wf-moss: #9bc6a5;
      --wf-text-muted: #c7bcaa;
      --wf-surface-panel: #171512;
      --wf-surface-input: #211e1a;
      --wf-surface-card: rgba(255,250,240,.065);
      --wf-surface-moss: rgba(155,198,165,.12);
      --wf-surface-gold: rgba(232,184,90,.14);
      --wf-surface-error: rgba(240,138,99,.12);
      --wf-line: rgba(244,234,216,.24);
      --wf-focus: #79b8ff;
      --wf-shadow: rgba(0,0,0,.5);
      --wf-shadow-hard: rgba(0,0,0,.42);
      --wf-warning-text: #ead5a4;
      --wf-provenance-text: #f2c76e;
      --wf-ping-shadow: rgba(240,138,99,.5);
    }
  }

  :host([hidden]) { display: none !important; }

  * { box-sizing: border-box; }
  .wf-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

  .wf-layer {
    position: fixed;
    inset: 0;
    z-index: 2147483600;
    pointer-events: none;
  }

  .wf-highlight {
    position: fixed;
    border: 2px solid var(--wf-gold);
    border-radius: 10px;
    box-shadow: 0 0 0 4px var(--wf-surface-gold), 0 12px 36px var(--wf-shadow);
    opacity: 0;
    transition: left 520ms cubic-bezier(.2,.8,.2,1), top 520ms cubic-bezier(.2,.8,.2,1), width 520ms cubic-bezier(.2,.8,.2,1), height 520ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease;
  }

  .wf-highlight.visible { opacity: 1; }

  .wf-dock {
    position: fixed;
    left: calc(100vw - 82px);
    top: calc(100vh - 86px);
    width: 56px;
    height: 64px;
    pointer-events: none;
    transition: left 1200ms cubic-bezier(.22,.61,.36,1), top 1200ms cubic-bezier(.22,.61,.36,1);
  }
  .wf-dock.settled { transition: none; }

  .wf-helper {
    position: absolute;
    inset: 0;
    width: 56px;
    height: 64px;
    pointer-events: auto;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    filter: drop-shadow(0 9px 10px var(--wf-shadow));
    transition: transform 180ms ease;
  }

  .wf-helper:hover { transform: translateY(-3px) rotate(-2deg); }
  .wf-helper.stationed:hover { transform: none; }
  .wf-helper.stationed .wf-body { animation: none; }
  .wf-helper:focus-visible { outline: 3px solid var(--wf-focus); outline-offset: 5px; border-radius: 50%; }

  .wf-body {
    position: absolute;
    left: 3px;
    top: 0;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: var(--wf-paper);
    border: 2px solid var(--wf-ink);
    box-shadow: inset 0 0 0 4px var(--wf-gold), inset 0 0 0 6px var(--wf-ink);
    animation: wf-bob 3.2s ease-in-out infinite;
  }

  .wf-face {
    position: absolute;
    left: 15px;
    top: 18px;
    width: 5px;
    height: 6px;
    border-radius: 50%;
    background: var(--wf-ink);
    box-shadow: 14px 0 0 var(--wf-ink);
  }

  .wf-face::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 8px;
    width: 8px;
    height: 4px;
    border-bottom: 2px solid var(--wf-ink);
    border-radius: 50%;
  }

  .wf-needle {
    position: absolute;
    left: 23px;
    top: 5px;
    width: 4px;
    height: 18px;
    border-radius: 4px;
    background: linear-gradient(to bottom, var(--wf-rust) 0 50%, var(--wf-ink) 50%);
    transform-origin: 2px 20px;
    animation: wf-seek 4.8s ease-in-out infinite;
  }

  .wf-feet::before,
  .wf-feet::after {
    content: '';
    position: absolute;
    top: 49px;
    width: 17px;
    height: 10px;
    border: 2px solid var(--wf-ink);
    border-top: 0;
    border-radius: 0 0 12px 12px;
    background: var(--wf-gold);
  }
  .wf-feet::before { left: 7px; transform: rotate(8deg); }
  .wf-feet::after { right: 7px; transform: rotate(-8deg); }

  .wf-ping {
    position: absolute;
    right: -3px;
    top: -3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--wf-rust);
    border: 2px solid var(--wf-paper);
    animation: wf-ping 2.4s ease-out infinite;
  }
  :host([data-mode="quick"]) .wf-ping,
  :host([data-seen="true"]) .wf-ping { display: none; }

  .wf-bubble {
    position: absolute;
    left: 0;
    top: 0;
    width: min(326px, calc(100vw - 28px));
    max-height: min(430px, calc(100vh - 28px));
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    pointer-events: auto;
    padding: 18px;
    border: 1px solid var(--wf-ink);
    border-radius: 18px 18px 5px 18px;
    background:
      radial-gradient(circle at 90% 10%, var(--wf-surface-gold), transparent 34%),
      var(--wf-surface-panel);
    box-shadow: 7px 7px 0 var(--wf-shadow-hard), 0 18px 50px var(--wf-shadow);
    opacity: 0;
    transform: translateY(10px) scale(.97);
    transform-origin: 100% 100%;
    visibility: hidden;
    transition: opacity 180ms ease, transform 220ms cubic-bezier(.2,.8,.2,1), visibility 180ms;
  }

  .wf-bubble.open { opacity: 1; transform: none; visibility: visible; }
  .wf-bubble.agent { width: min(430px, calc(100vw - 28px)); max-height: min(610px, calc(100vh - 28px)); border-radius: 18px 18px 5px 18px; }

  .wf-kicker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    color: var(--wf-rust);
    font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .16em;
    text-transform: uppercase;
  }

  .wf-kicker.wf-top-kicker { padding-right: 36px; }

  .wf-step-count { color: var(--wf-moss); }

  .wf-bubble h2 {
    margin: 0 26px 7px 0;
    color: var(--wf-ink);
    font: 600 23px/1.05 Georgia, 'Times New Roman', serif;
    letter-spacing: -.025em;
  }

  .wf-bubble p {
    margin: 0;
    color: var(--wf-text-muted);
    font: 15px/1.48 Georgia, 'Times New Roman', serif;
  }

  .wf-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 15px;
  }

  .wf-actions button,
  .wf-close {
    appearance: none;
    border: 1px solid var(--wf-ink);
    border-radius: 999px;
    background: transparent;
    color: var(--wf-ink);
    cursor: pointer;
    font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .04em;
  }

  .wf-actions button { min-height: 34px; padding: 0 13px; }
  .wf-actions .primary { background: var(--wf-ink); color: var(--wf-paper); }
  .wf-actions button:hover { transform: translateY(-1px); box-shadow: 0 3px 0 var(--wf-shadow-hard); }
  .wf-actions button:focus-visible, .wf-close:focus-visible { outline: 2px solid var(--wf-focus); outline-offset: 2px; }

  .wf-close {
    position: absolute;
    right: 12px;
    top: 12px;
    width: 28px;
    height: 28px;
    padding: 0;
    border-color: transparent;
    font-size: 16px;
  }

  .wf-tip {
    margin-top: 13px !important;
    padding-top: 11px;
    border-top: 1px dashed var(--wf-line);
    color: var(--wf-text-muted) !important;
    font-size: 12px !important;
  }

  .wf-agent-head { padding-right: 0; }
  .wf-mode-switch { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--wf-line); border-radius: 999px; background: var(--wf-surface-card); }
  .wf-mode-switch button { padding: 5px 8px; border: 0; border-radius: 999px; background: transparent; color: var(--wf-text-muted); cursor: pointer; font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .06em; text-transform: uppercase; }
  .wf-mode-switch button.active { background: var(--wf-ink); color: var(--wf-paper); }
  .wf-mode-switch button:focus-visible { outline: 2px solid var(--wf-focus); outline-offset: 2px; }
  .wf-agent-head h2 { margin-bottom: 5px; }
  .wf-agent-head p { font-size: 13px; }
  .wf-agent-home { display: grid; gap: 12px; }
  .wf-question-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .wf-question-grid button {
    min-height: 58px;
    padding: 9px 10px;
    border: 1px solid var(--wf-line);
    border-radius: 10px;
    background: var(--wf-surface-card);
    color: var(--wf-ink);
    cursor: pointer;
    text-align: left;
    font: 700 11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .wf-question-grid button:hover,
  .wf-question-grid button:focus-visible { border-color: var(--wf-gold); background: var(--wf-surface-gold); }
  .wf-composer { display: grid; grid-template-columns: 1fr auto; gap: 7px; padding-top: 11px; border-top: 1px dashed var(--wf-line); }
  .wf-composer textarea {
    min-height: 58px;
    resize: vertical;
    padding: 10px 11px;
    border: 1px solid var(--wf-line);
    border-radius: 10px;
    background: var(--wf-surface-input);
    color: var(--wf-ink);
    font: 13px/1.35 Georgia, 'Times New Roman', serif;
  }
  .wf-composer button {
    align-self: stretch;
    padding: 0 13px;
    border: 0;
    border-radius: 10px;
    background: var(--wf-ink);
    color: var(--wf-paper);
    cursor: pointer;
    font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .wf-question-grid button:focus-visible,
  .wf-composer textarea:focus-visible,
  .wf-composer button:focus-visible,
  .wf-followups button:focus-visible,
  .wf-answer-nav button:focus-visible,
  details.wf-detail summary:focus-visible {
    outline: 2px solid var(--wf-focus);
    outline-offset: 2px;
  }
  .wf-composer textarea:focus-visible { border-color: var(--wf-focus); box-shadow: 0 0 0 3px var(--wf-surface-gold); }
  .wf-composer button:hover,
  .wf-composer button:focus-visible { background: var(--wf-rust); }
  .wf-loading { display: grid; place-items: center; min-height: 190px; text-align: center; }
  .wf-loading-mark { width: 42px; height: 42px; margin-bottom: 15px; border: 2px solid var(--wf-line); border-top-color: var(--wf-rust); border-radius: 50%; animation: wf-spin 900ms linear infinite; }
  .wf-answer { display: grid; gap: 13px; }
  .wf-answer-mode { display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid var(--wf-line); border-radius: 9px; background: var(--wf-surface-moss); color: var(--wf-moss); font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .09em; text-transform: uppercase; }
  .wf-answer-mode.model { background: var(--wf-surface-gold); color: var(--wf-provenance-text); }
  .wf-cache-note { color: var(--wf-text-muted) !important; font: 700 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace !important; letter-spacing: .04em; }
  .wf-confidence { display: inline-flex; margin-top: 7px; padding: 3px 6px; border-radius: 999px; background: var(--wf-surface-moss); color: var(--wf-moss); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
  .wf-warning-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .wf-warning-list li { padding: 8px 10px; border-left: 3px solid var(--wf-gold); background: var(--wf-surface-gold); color: var(--wf-warning-text); font: 12px/1.4 Georgia, 'Times New Roman', serif; }
  .wf-answer-summary { color: var(--wf-ink) !important; font-size: 17px !important; line-height: 1.4 !important; }
  .wf-answer-explanation { font-size: 13px !important; }
  .wf-result-list, .wf-route-list, .wf-brief { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .wf-result, .wf-route-list li, .wf-brief li { padding: 10px; border: 1px solid var(--wf-line); border-radius: 10px; background: var(--wf-surface-card); }
  .wf-result strong, .wf-route-list strong, .wf-brief strong { display: block; color: var(--wf-ink); font: 700 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .wf-result p, .wf-route-list p, .wf-brief p { margin-top: 5px; font-size: 12px; }
  .wf-snapshot { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .wf-fact { min-width: 0; padding: 10px; border: 1px solid var(--wf-line); border-radius: 10px; background: var(--wf-surface-card); }
  .wf-fact.wide { grid-column: 1 / -1; }
  .wf-fact span { display: block; margin-bottom: 5px; color: var(--wf-text-muted); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; text-transform: uppercase; }
  .wf-fact strong { display: block; color: var(--wf-ink); font: 700 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .wf-signal-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
  .wf-signal { padding: 3px 5px; border-radius: 999px; background: var(--wf-surface-moss); color: var(--wf-moss); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wf-project-fact { margin-top: 12px; padding: 10px; border-left: 3px solid var(--wf-moss); background: var(--wf-surface-moss); }
  .wf-project-fact strong { display: block; margin-bottom: 3px; color: var(--wf-moss); font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
  .wf-boundary { padding: 9px 10px; border: 1px solid var(--wf-gold); border-radius: 9px; background: var(--wf-surface-gold); color: var(--wf-warning-text); font: 12px/1.4 Georgia, 'Times New Roman', serif; }
  .wf-detail-toggle { display: flex; gap: 5px; }
  .wf-detail-toggle button { padding: 5px 7px; border: 1px solid var(--wf-line); border-radius: 999px; background: transparent; color: var(--wf-moss); cursor: pointer; font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
  .wf-detail-toggle button.active { background: var(--wf-moss); color: var(--wf-paper); }
  .wf-detail-toggle button:focus-visible { outline: 2px solid var(--wf-focus); outline-offset: 2px; }
  .wf-answer.concise .wf-detail { display: none; }
  details.wf-detail { padding: 8px 10px; border: 1px solid var(--wf-line); border-radius: 10px; }
  details.wf-detail summary { cursor: pointer; color: var(--wf-moss); font: 700 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
  details.wf-detail summary:hover,
  details.wf-detail summary:focus-visible { color: var(--wf-rust); }
  .wf-open, .wf-copy-command {
    width: 100%; margin-top: 8px; padding: 8px 10px; border: 1px solid var(--wf-ink); border-radius: 8px; background: transparent; color: var(--wf-ink); cursor: pointer; text-align: left; font: 700 10px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere;
  }
  .wf-open { display: block; text-decoration: none; }
  .wf-open:hover, .wf-open:focus-visible { border-color: var(--wf-gold); background: var(--wf-surface-gold); }
  .wf-open:focus-visible, .wf-copy-command:focus-visible { outline: 2px solid var(--wf-focus); outline-offset: 2px; }
  .wf-copy-command { background: var(--wf-ink); color: var(--wf-paper); }
  .wf-copy-command[aria-busy="true"] { cursor: progress; opacity: .72; }
  .wf-copy-command[data-copy-state]::after { content: attr(data-copy-state); float: right; margin-left: 10px; color: var(--wf-gold); }
  .wf-command-note { display: block; margin-top: 5px; color: var(--wf-rust); font: 600 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wf-evidence { display: flex; flex-wrap: wrap; gap: 6px; }
  .wf-evidence .wf-open { display: inline-flex; width: auto; margin-top: 0; }
  .wf-evidence a, .wf-followups button { padding: 7px 9px; border: 1px solid var(--wf-line); border-radius: 999px; background: transparent; color: var(--wf-moss); cursor: pointer; font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
  .wf-evidence a { text-decoration: none; }
  .wf-evidence a:hover, .wf-evidence a:focus-visible { border-color: var(--wf-gold); background: var(--wf-surface-gold); outline-color: var(--wf-focus); }
  .wf-followups { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 10px; border-top: 1px dashed var(--wf-line); }
  .wf-followups button:hover,
  .wf-followups button:focus-visible { border-color: var(--wf-gold); background: var(--wf-surface-gold); }
  .wf-answer-nav { display: flex; justify-content: space-between; gap: 8px; }
  .wf-answer-nav button { padding: 7px 10px; border: 0; background: transparent; color: var(--wf-rust); cursor: pointer; font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wf-answer-nav button:hover,
  .wf-answer-nav button:focus-visible { background: var(--wf-surface-gold); border-radius: 7px; }
  .wf-error { padding: 13px; border: 1px solid var(--wf-rust); border-radius: 10px; background: var(--wf-surface-error); }
  .wf-error p { font-size: 13px; }
  @keyframes wf-spin { to { transform: rotate(360deg); } }

  @keyframes wf-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
  @keyframes wf-seek { 0%,100% { transform: rotate(-28deg) } 48% { transform: rotate(24deg) } 60% { transform: rotate(19deg) } }
  @keyframes wf-ping { 0% { box-shadow: 0 0 0 0 var(--wf-ping-shadow) } 70%,100% { box-shadow: 0 0 0 9px transparent } }

  @media (prefers-reduced-motion: reduce) {
    .wf-dock, .wf-helper, .wf-highlight, .wf-bubble { transition-duration: 0ms; }
    .wf-body, .wf-needle, .wf-ping { animation: none; }
    .wf-loading-mark { animation: none; }
  }

  @media (max-width: 420px) {
    .wf-question-grid,
    .wf-composer { grid-template-columns: 1fr; }
    .wf-question-grid button { min-height: 48px; }
    .wf-composer button { min-height: 40px; }
  }

  @media (forced-colors: active) {
    .wf-highlight { border-color: Highlight; box-shadow: none; }
    .wf-helper:focus-visible,
    .wf-bubble :focus-visible { outline-color: Highlight; }
  }
`;
