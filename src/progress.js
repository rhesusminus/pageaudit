import ora from 'ora'
import { limit } from './text.js'

// ora sizes its line clearing as ceil(width / columns), so a TTY that reports
// 0 columns (Docker -t, some CI terminals) makes spinner.stop() loop forever.
export function canSpin(stream) {
  return Boolean(stream.isTTY) && stream.columns > 0
}

const BAR_WIDTH = 20

// A bar and percent for a fraction from 0 to 1. Both round down, so they reach the end only when the work is done,
// and the percent is padded so the text after it does not move as it grows. The bar is filled from the whole percent,
// so the two always agree, and the epsilon keeps a fraction like 1.2 / 3 from rounding down to 39%.
export function progressBar(fraction) {
  const percent = Math.floor(fraction * 100 + 1e-9)
  const filled = Math.floor((percent * BAR_WIDTH) / 100)
  return `[${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}] ${String(percent).padStart(3)}%`
}

// The Lighthouse spinner line: a bar over every run of every page, then pages done or, once a page reports its phase,
// the page being run, its phase and, with several runs, which run. Within a run the bar moves to where the phase
// starts, which is approximate. The line is cut to the terminal width, since a spinner line that wraps leaves its first
// half behind on every redraw, and the bar comes first so it is cut last. ora puts the spinner and a space in front.
// Kept short enough that page 12/40 on run 2/3 shows its longest phase whole in an 80-column terminal.
export function lighthouseProgress({ done, phase, run }, total, runs, columns) {
  const runsDone = done * runs + (phase ? run - 1 + phase.progress : 0)
  const runText = runs > 1 ? `, run ${run}/${runs}` : ''
  const status = phase ? `page ${done + 1}/${total}${runText}: ${phase.text}` : `${done}/${total} pages...`
  const text = `Lighthouse ${progressBar(runsDone / (total * runs))} ${status}`
  return columns > 0 ? limit(text, columns - 2) : text
}

// A handle that shows nothing. Its fail still prints the message, so a failure is never lost with the spinner.
const SILENT = {
  update() {},
  stop() {},
  fail: (message) => console.error(message)
}

// The spinners of a run, on `stream`. They show only when `enabled`, which is false for JSON output, and the stream
// can show them. Otherwise every handle is silent, so callers never check. `spinner` makes the spinners, ora but for
// tests. `silent` is the handle for a step that never shows a spinner, but still reports a failure.
export function createProgress({ enabled, stream, spinner = ora }) {
  const shown = enabled && canSpin(stream)
  const start = (text) => {
    if (!shown) return SILENT
    const current = spinner({ text, stream }).start()
    return {
      update: (next) => {
        current.text = next
      },
      stop: () => current.stop(),
      fail: (message) => current.fail(message)
    }
  }
  // The Lighthouse spinner, with the callbacks runLighthouse reports to. A finished page resets the phase. The
  // terminal width is read on every update, so a resized terminal still gets a line that fits.
  const lighthouse = (total, runs) => {
    const state = { done: 0, phase: null, run: 1 }
    const text = () => lighthouseProgress(state, total, runs, stream.columns)
    const handle = start(text())
    const show = (change) => {
      Object.assign(state, change)
      handle.update(text())
    }
    return {
      onProgress: (done) => show({ done, phase: null, run: 1 }),
      onStatus: (phase, run) => show({ phase, run }),
      stop: handle.stop
    }
  }
  return { start, lighthouse, silent: SILENT }
}
