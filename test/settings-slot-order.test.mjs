import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const cases = [
  {
    id: 'dsh-skill-panel',
    file: new URL('../ai-agent/dsh-skill-panel/lib/client.js', import.meta.url),
    registrationId: 'skills',
  },
  {
    id: 'dsh-mcp-panel',
    file: new URL('../service/dsh-mcp-panel/lib/client.js', import.meta.url),
    registrationId: 'mcp',
  },
]

const React = {
  Fragment: Symbol('Fragment'),
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

function createUndeclaredSlotContext() {
  const pending = []
  const registrations = []
  let declared = false

  const ctx = {
    effect(effect) {
      return effect()
    },
    slots: {
      inject(name, registerWhenDeclared) {
        pending.push({ name, registerWhenDeclared })
        return function disposeInjection() {}
      },
      register(entry, component) {
        if (!declared) {
          throw new Error(`slot "${entry.name}" is not declared`)
        }
        registrations.push({ entry, component })
        return function disposeRegistration() {}
      },
    },
  }

  return {
    ctx,
    pending,
    registrations,
    declare() {
      declared = true
      for (const injection of pending) injection.registerWhenDeclared()
    },
  }
}

for (const fixture of cases) {
  test(`${fixture.id} waits for settings.section before registering`, async () => {
    const plugin = await loadClient(fixture.file)
    const slots = createUndeclaredSlotContext()

    assert.doesNotThrow(() => plugin.apply(slots.ctx))
    assert.equal(slots.registrations.length, 0, 'nothing registers before declaration')
    assert.equal(slots.pending.length, 1, 'one deferred slot injection is installed')
    assert.equal(slots.pending[0].name, 'settings.section')

    slots.declare()
    assert.equal(slots.registrations.length, 1, 'the section registers after declaration')
    assert.equal(slots.registrations[0].entry.name, 'settings.section')
    assert.equal(slots.registrations[0].entry.id, fixture.registrationId)
    assert.equal(typeof slots.registrations[0].component, 'function')
  })
}
