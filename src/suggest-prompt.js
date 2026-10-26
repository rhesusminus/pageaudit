import { styleText } from 'node:util'
import { settings, TextPrompt } from '@clack/core'
import { S_BAR, S_BAR_END, symbol } from '@clack/prompts'

const HINT = 'Enter to use it, Tab to edit it'

// A text question with a suggested answer, shown dim like a placeholder. An empty Enter takes the suggestion and
// Tab puts it in the input, so it can be changed instead of typed again. clack's own text() drops Tab and has no
// hook for it.
class SuggestPrompt extends TextPrompt {
  constructor(opts) {
    super(opts)
    this.on('key', (_char, key) => {
      if (key?.name === 'tab' && !this.userInput) this._setUserInput(opts.defaultValue, true)
    })
  }
}

// Draws the question like clack's text() does, with the hint under an empty input.
function render() {
  const guide = this.opts.withGuide ?? settings.withGuide
  const title = `${guide ? `${styleText('gray', S_BAR)}\n` : ''}${symbol(this.state)}  ${this.opts.message}\n`
  const suggestion = this.opts.defaultValue
  const empty = styleText('inverse', suggestion[0]) + styleText('dim', suggestion.slice(1))
  const input = this.userInput ? this.userInputWithCursor : empty
  const value = this.value ?? ''
  switch (this.state) {
    case 'error': {
      const bar = guide ? `${styleText('yellow', S_BAR)}  ` : ''
      const end = guide ? styleText('yellow', S_BAR_END) : ''
      return `${title.trim()}\n${bar}${input}\n${end}${this.error ? `  ${styleText('yellow', this.error)}` : ''}\n`
    }
    case 'submit': {
      const answer = value ? `${guide ? '  ' : ''}${styleText('dim', value)}` : ''
      return `${title}${guide ? styleText('gray', S_BAR) : ''}${answer}`
    }
    case 'cancel': {
      const bar = guide ? styleText('gray', S_BAR) : ''
      const answer = value ? `  ${styleText(['strikethrough', 'dim'], value)}` : ''
      return `${title}${bar}${answer}${value.trim() ? `\n${bar}` : ''}`
    }
    default: {
      const bar = guide ? `${styleText('cyan', S_BAR)}  ` : ''
      const end = guide ? styleText('cyan', S_BAR_END) : ''
      const hint = this.userInput ? '' : `  ${styleText('dim', HINT)}`
      return `${title}${bar}${input}\n${end}${hint}\n`
    }
  }
}

// Asks a question whose answer is `suggestion` unless another is typed. Takes clack's text() options except
// `placeholder` and `defaultValue`. Returns the answer or clack's cancel symbol.
export const suggest = ({ suggestion, ...opts }) =>
  new SuggestPrompt({ ...opts, placeholder: suggestion, defaultValue: suggestion, render }).prompt()
