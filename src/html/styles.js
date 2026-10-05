// The report's stylesheet. System fonts only, so the file needs no network and looks the
// same offline. Colors are tokens on :root and redefined for dark mode and for print.
export const CSS = `
:root {
  --ink: #16202e;
  --ink-2: #46536a;
  --canvas: #f2f4f8;
  --panel: #ffffff;
  --line: #d8dde8;
  --accent: #2f43c9;
  --err: #b3232f;
  --warn: #8a4f00;
  --info: #4a5870;
  --good: #16744a;
  --err-fill: #d6404e;
  --warn-fill: #e39a1b;
  --good-fill: #2ba672;
  --cover-bg: #16202e;
  --cover-fg: #f2f4f8;
  --cover-dim: #aab6c9;
  --cover-track: rgba(255, 255, 255, 0.16);
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8ecf3;
    --ink-2: #a7b2c4;
    --canvas: #0f141c;
    --panel: #171e29;
    --line: #2a3342;
    --accent: #93a4ff;
    --err: #ff8b94;
    --warn: #f2b35b;
    --info: #a9b4c7;
    --good: #5cd1a0;
    --err-fill: #ef6573;
    --warn-fill: #e8a537;
    --good-fill: #3fbd8a;
    --cover-bg: #0a0e14;
    --cover-fg: #e8ecf3;
    color-scheme: dark;
  }
}

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font: 400 1rem/1.6 var(--sans);
  -webkit-font-smoothing: antialiased;
}
.wrap { width: min(100% - 2 * clamp(1rem, 4vw, 2rem), 62rem); margin-inline: auto; }
main.wrap { padding-block: 2.5rem 3rem; display: grid; gap: 3rem; }
a { color: var(--accent); text-underline-offset: 0.18em; }
a:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
h1, h2 { font-family: var(--serif); font-weight: 600; letter-spacing: -0.012em; margin: 0; }
h2 { font-size: 1.75rem; line-height: 1.2; margin-bottom: 0.5rem; }
h3 { font-size: 1.05rem; line-height: 1.35; margin: 0 0 0.35rem; }
p { margin: 0 0 0.75rem; max-width: 68ch; }
code {
  display: block;
  font: 0.8125rem/1.5 var(--mono);
  color: var(--ink-2);
  overflow-wrap: anywhere;
  margin-top: 0.15rem;
}
.note { color: var(--ink-2); font-size: 0.875rem; }
.lede { color: var(--ink-2); }
ul, ol { margin: 0; padding: 0; list-style: none; }

/* cover */
.cover { background: var(--cover-bg); color: var(--cover-fg); padding-block: clamp(2rem, 6vw, 4rem); }
.logo { display: block; max-height: 3.25rem; max-width: 14rem; margin-bottom: 2rem; object-fit: contain; }
.client { margin: 0 0 0.5rem; color: var(--cover-dim); font-size: 1.0625rem; }
.cover h1 { font-size: clamp(2.25rem, 6vw, 3.75rem); line-height: 1.05; max-width: 20ch; }
.verdict { font: 400 clamp(1.125rem, 2.4vw, 1.5rem)/1.4 var(--serif); margin: 1.25rem 0 0; max-width: 34ch; }
.facts-line { display: flex; flex-wrap: wrap; gap: 0.5rem 2.5rem; margin: 1.75rem 0 0; }
.facts-line dt { color: var(--cover-dim); font-size: 0.875rem; }
.facts-line dd { margin: 0; font-weight: 600; }
.rings { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 1.5rem 1rem; margin-top: 2.5rem; max-width: 40rem; }
.rings-note { margin: 1.25rem 0 0; color: var(--cover-dim); font-size: 0.875rem; }
.ring { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; }
.ring svg { width: 6.5rem; height: 6.5rem; margin-bottom: 0.35rem; overflow: visible; }
.ring .track, .ring .arc { fill: none; stroke-width: 11; }
.ring .track { stroke: var(--cover-track); }
.ring .arc { stroke-linecap: round; }
.ring-good .arc { stroke: var(--good-fill); }
.ring-average .arc { stroke: var(--warn-fill); }
.ring-poor .arc { stroke: var(--err-fill); }
.ring .num { fill: var(--cover-fg); font: 600 38px var(--serif); }
.ring-label { font-weight: 600; }
.ring-word, .ring-na { color: var(--cover-dim); font-size: 0.875rem; }
.ring-na { font: 600 1.5rem var(--serif); height: 6.5rem; display: grid; place-items: center start; }
@media (prefers-reduced-motion: no-preference) {
  .ring .arc { animation: draw 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
  @keyframes draw { from { stroke-dasharray: 0 100; } }
}

/* severity: a shape and a word, never color alone */
.sev { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.875rem; font-weight: 600; }
.sev::before { content: ""; width: 0.65rem; height: 0.65rem; background: currentColor; flex: none; }
.sev-error { color: var(--err); }
.sev-error::before { transform: rotate(45deg) scale(0.9); }
.sev-warning { color: var(--warn); }
.sev-warning::before { clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.sev-info { color: var(--info); }
.sev-info::before { border-radius: 50%; }
.sev-good { color: var(--good); }
.sev-good::before { border-radius: 2px; }

/* panels and summary */
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: clamp(1.25rem, 3vw, 2rem); }
.health { display: flex; gap: 3px; height: 0.9rem; margin: 1.25rem 0 1rem; border-radius: 0.45rem; overflow: hidden; background: var(--line); }
.seg-errors { background: var(--err-fill); }
.seg-warnings { background: var(--warn-fill); }
.seg-clean { background: var(--good-fill); }
.legend { display: flex; flex-wrap: wrap; gap: 0.5rem 2rem; }
.legend li { font-weight: 400; color: var(--ink); }
.legend strong { font-weight: 700; }
.legend .sev-error::before { background: var(--err-fill); }
.legend .sev-warning::before { background: var(--warn-fill); }
.legend .sev-good::before { background: var(--good-fill); }

/* what to fix */
.fixes { display: grid; gap: 0; margin-top: 1.25rem; border-top: 1px solid var(--line); }
.fix { display: grid; grid-template-columns: 3rem 1fr; gap: 0 0.75rem; padding: 1.5rem 0; border-bottom: 1px solid var(--line); }
.fix-num { font: 600 2rem/1 var(--serif); color: var(--ink-2); }
.fix-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1rem; margin-bottom: 0.4rem; }
.fix-count { color: var(--ink-2); font-size: 0.875rem; }
.fix-body details { margin-top: 0.5rem; }
.affected { display: grid; gap: 0.75rem; margin-top: 0.75rem; padding-left: 1rem; border-left: 2px solid var(--line); }
.urls { display: grid; gap: 0.15rem; overflow-wrap: anywhere; font-size: 0.9375rem; }
.affected .note { display: block; }

/* collapsible sections */
summary { cursor: pointer; font-weight: 600; list-style: none; }
summary::-webkit-details-marker { display: none; }
.fix-body summary { color: var(--accent); font-size: 0.9375rem; }
.fix-body summary::before, .page > summary::before {
  content: ""; display: inline-block; width: 0.5em; height: 0.5em; margin-right: 0.6em;
  border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
  transform: translateY(-0.12em) rotate(-45deg); transition: transform 0.15s;
}
details[open] > summary::before { transform: translateY(-0.2em) rotate(45deg); }

/* pages */
.pages { display: grid; gap: 0.75rem; margin-top: 1.25rem; }
.page { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.page > summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; padding: 1rem 1.25rem; }
.page-url { flex: 1 1 18rem; overflow-wrap: anywhere; display: inline-flex; align-items: baseline; }
.page-chips, .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.chip { display: inline-block; padding: 0.15rem 0.65rem; border: 1px solid var(--line); border-radius: 999px; font-size: 0.8125rem; font-weight: 500; color: var(--ink-2); }
.chip strong { color: var(--ink); }
.chip-good { border-color: var(--good); }
.chip-average { border-color: var(--warn); }
.chip-poor { border-color: var(--err); }
.page-body { padding: 0 1.25rem 1.5rem; border-top: 1px solid var(--line); }
.page-body h3 { margin-top: 1.5rem; }
.facts { display: grid; gap: 0.6rem; margin: 1.25rem 0 0; }
.facts div { display: grid; grid-template-columns: 8.5rem 1fr; gap: 0.75rem; }
.facts dt { color: var(--ink-2); font-size: 0.9375rem; }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.missing { color: var(--err); font-weight: 600; }
.issues, .audits { display: grid; gap: 0.9rem; }
.issues li { display: grid; gap: 0.1rem; }
.issue-text { overflow-wrap: anywhere; font-weight: 600; }
.clean { margin: 1.25rem 0 0; color: var(--good); font-weight: 600; }
.metrics { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.9375rem; }
.metrics th { text-align: left; font-weight: 400; color: var(--ink-2); }
.metrics th, .metrics td { padding: 0.45rem 0; border-bottom: 1px solid var(--line); }
.metrics td:nth-child(2) { font-variant-numeric: tabular-nums; }
.metrics td:last-child { text-align: right; }
.band { font-weight: 600; }
.band-good { color: var(--good); }
.band-average { color: var(--warn); }
.band-poor { color: var(--err); }
.audit-score { display: inline-block; min-width: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.sources { display: grid; gap: 0.25rem; margin-top: 0.5rem; font-size: 0.875rem; overflow-wrap: anywhere; }
.site-footer { padding-bottom: 3rem; color: var(--ink-2); font-size: 0.875rem; }

@media (max-width: 36rem) {
  .fix { grid-template-columns: 1fr; }
  .fix-num { font-size: 1.25rem; margin-bottom: 0.25rem; }
  .facts div { grid-template-columns: 1fr; gap: 0; }
}

@media print {
  :root {
    --canvas: #ffffff; --panel: #ffffff; --ink: #16202e; --ink-2: #46536a; --line: #c9cfdb;
    --cover-bg: #ffffff; --cover-fg: #16202e; --cover-dim: #46536a; --cover-track: #e1e5ee;
    --err: #b3232f; --warn: #8a4f00; --info: #4a5870; --good: #16744a; --accent: #2f43c9;
  }
  body { font-size: 11pt; }
  .cover { border-bottom: 2px solid var(--ink); padding-block: 0 1.5rem; }
  main.wrap { padding-top: 1.5rem; gap: 1.5rem; }
  .panel, .page { border-radius: 0; }
  .ring .arc { animation: none; }
  .fix, .page > summary, .issues li, .affected li { break-inside: avoid; }
  .page { break-inside: auto; }
  h2, h3, .lede { break-after: avoid; }
  summary::before { display: none !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`
