/* eslint-disable @typescript-eslint/no-explicit-any */

import {Comment, Context} from '../src/ciflow'

describe('Comment', () => {
  test('parse happy path', () => {
    const ctx = new Context()
    const c = new Comment()
    c.body = `
# 📚 ciflow test plan!
- [x] ci/default
  - ciflow_lint.yml
  - ciflow_linux.yml
  - ciflow_windows.yml
  - ciflow_mac.yml
- [ ] ci/extra
  - ciflow_linux_extra.yml
  - ciflow_windows_extra.yml
  - ciflow_mac_extra.yml
- [ ] ci/cuda
  - ciflow_windows_cuda.yml
    `

    c.parse(ctx, c.body)
    expect([...ctx.plan.label_workflows.keys()]).toEqual(['ci/default'])
    expect(ctx.plan.workflows).toEqual(
      new Set<string>([
        'ciflow_lint.yml',
        'ciflow_linux.yml',
        'ciflow_windows.yml',
        'ciflow_mac.yml'
      ])
    )
  })

  test('parse empty body', () => {
    const c = new Comment()
    const ctx = new Context()
    c.body = ''
    c.parse(ctx, c.body)
    expect([...ctx.plan.label_workflows.keys()]).toEqual([])
    expect(ctx.plan.workflows).toEqual(new Set<string>())
  })

  test('parse empty body with header', () => {
    const c = new Comment()
    const ctx = new Context()
    c.body = `# 📚 ciflow test plan!\n`
    c.parse(ctx, c.body)
    expect([...ctx.plan.label_workflows.keys()]).toEqual([])
    expect(ctx.plan.workflows).toEqual(new Set<string>())
  })
})
