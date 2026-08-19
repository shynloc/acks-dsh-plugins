import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const cases = [
  {
    id: 'mimo-vision',
    file: new URL('../ai-agent/mimo-vision/lib/client.js', import.meta.url),
  },
  {
    id: 'dsh-imagegen',
    file: new URL('../creative/dsh-imagegen/lib/client.js', import.meta.url),
  },
  {
    id: 'dsh-xai-imagine',
    file: new URL('../creative/dsh-xai-imagine/lib/client.js', import.meta.url),
  },
  {
    id: 'dsh-github',
    file: new URL('../service/dsh-github/lib/client.js', import.meta.url),
  },
]

const React = {
  createElement() {},
  useEffect() {},
  useState(initial) {
    return [initial, function setState() {}]
  },
}

async function loadClient(file) {
  let descriptor
  const source = await readFile(file, 'utf8')
  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(value) {
          descriptor = value
        },
      },
    },
  })
  vm.runInContext(source, context, { filename: file.pathname })
  assert.ok(descriptor, 'client bundle registers with the module loader')
  return descriptor.factory(function requireShared(id) {
    assert.equal(id, 'react')
    return React
  })
}

function createContext() {
  const pending = []
  const registrations = []
  return {
    pending,
    registrations,
    ctx: {
      get(name) {
        assert.equal(name, 'connection')
        return { api: { credentials: {} } }
      },
      slots: {
        inject(name, registerWhenDeclared) {
          pending.push({ name, registerWhenDeclared })
          return function disposeInjection() {}
        },
        register(entry, component) {
          if (entry.name === 'settings.plugin.item' && !entry.key) {
            throw new Error('keyed slot "settings.plugin.item" requires options.key')
          }
          registrations.push({ entry, component })
          return function disposeRegistration() {}
        },
      },
    },
  }
}

for (const fixture of cases) {
  test(`${fixture.id} keys its settings card by the plugin namespace`, async () => {
    const plugin = await loadClient(fixture.file)
    const slots = createContext()

    plugin.apply(slots.ctx)
    assert.equal(slots.pending.length, 1)
    assert.equal(slots.pending[0].name, 'settings.plugin.item')
    assert.doesNotThrow(() => slots.pending[0].registerWhenDeclared())
    assert.equal(slots.registrations.length, 1)
    assert.equal(slots.registrations[0].entry.key, fixture.id)
  })
}
