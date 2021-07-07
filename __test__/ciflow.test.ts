/* eslint-disable @typescript-eslint/no-explicit-any */

import {Plan} from '../src/ciflow'

describe('Plan', () => {
  test('parse happy path', () => {
    const body = `
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

    const plan = Plan.parse(body)
    expect([...plan.tag_workflows.keys()]).toEqual(['ci/default'])
    expect(plan.workflows).toEqual(
      new Set<string>([
        'ciflow_lint.yml',
        'ciflow_linux.yml',
        'ciflow_windows.yml',
        'ciflow_mac.yml'
      ])
    )
    expect(plan.calculate_diff(new Plan()).added_tags).toEqual(['ci/default'])
  })

  test('parse empty body', () => {
    const body = ''
    const plan = Plan.parse(body)
    expect([...plan.tag_workflows.keys()]).toEqual([])
    expect(plan.workflows).toEqual(new Set<string>())
  })

  test('parse empty body with header', () => {
    const body = `# 📚 ciflow test plan!\n`
    const plan = Plan.parse(body)
    expect([...plan.tag_workflows.keys()]).toEqual([])
    expect(plan.workflows).toEqual(new Set<string>())
  })
})
