import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const cases = [
  {
    id: 'mimo-vision',
    file: new URL('../ai-agent/mimo-vision/lib/index.js', import.meta.url),
  },
  {
    id: 'dsh-imagegen',
    file: new URL('../creative/dsh-imagegen/lib/index.js', import.meta.url),
  },
  {
    id: 'dsh-xai-imagine',
    file: new URL('../creative/dsh-xai-imagine/lib/index.js', import.meta.url),
  },
  {
    id: 'dsh-github',
    file: new URL('../service/dsh-github/lib/index.js', import.meta.url),
  },
]

for (const fixture of cases) {
  test(`${fixture.id} serves the namespace used by its rc.7 settings card`, async () => {
    const source = await readFile(fixture.file, 'utf8')
    assert.match(source, /from ["']@deepseek-ai\/schemastery["']/u)
    assert.match(source, /ctx\.inject\(\[\s*["']settings["']\s*\]/u)
    assert.match(
      source,
      new RegExp(`settings\\.register\\(\\s*["']${fixture.id}["']`, 'u'),
    )
  })
}
