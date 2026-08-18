/**
 * Greedy wrap that only breaks on spaces (and hard newlines). A word that is wider
 * than the box is never split; the caller should shrink the font instead.
 */
export function wrapLinesAtSpaces(
  text: string,
  maxWidthDots: number,
  measureWidthDots: (value: string) => number,
  slackDots = 0.5
): { lines: string[]; wordOverflow: boolean } {
  const limit = maxWidthDots + slackDots
  const source = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ')
  const paragraphs = source.split('\n')
  const lines: string[] = []
  let wordOverflow = false

  for (const paragraph of paragraphs) {
    const wrapped = wrapParagraph(paragraph, limit, measureWidthDots)
    wordOverflow = wordOverflow || wrapped.wordOverflow
    lines.push(...wrapped.lines)
  }

  return { lines: lines.length > 0 ? lines : [''], wordOverflow }
}

function wrapParagraph(
  paragraph: string,
  limitDots: number,
  measureWidthDots: (value: string) => number
): { lines: string[]; wordOverflow: boolean } {
  if (paragraph === '') return { lines: [''], wordOverflow: false }

  const words = paragraph.split(' ')
  const lines: string[] = []
  let current = ''
  let wordOverflow = false

  const fits = (value: string) => measureWidthDots(value) <= limitDots

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (fits(candidate)) {
      current = candidate
      continue
    }
    if (current === '') {
      lines.push(word)
      wordOverflow = true
      current = ''
      continue
    }
    lines.push(current)
    current = word
    if (!fits(word)) {
      wordOverflow = true
    }
  }

  if (current !== '' || lines.length === 0) lines.push(current)
  return { lines, wordOverflow }
}
