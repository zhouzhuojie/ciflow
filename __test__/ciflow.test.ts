/* eslint-disable @typescript-eslint/no-explicit-any */

import {Comment} from '../src/ciflow'

describe('Comment', () => {
  test('parse happy path', () => {
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

    c.parse(c.body)
    expect([...c.label_workflows.keys()]).toEqual(['ci/default'])
    expect(c.workflows).toEqual(
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
    c.body = ''
    c.parse(c.body)
    expect([...c.label_workflows.keys()]).toEqual([])
    expect(c.workflows).toEqual(new Set<string>())
  })

  test('parse empty body with header', () => {
    const c = new Comment()
    c.body = `# 📚 ciflow test plan!\n`
    c.parse(c.body)
    expect([...c.label_workflows.keys()]).toEqual([])
    expect(c.workflows).toEqual(new Set<string>())
  })
})
