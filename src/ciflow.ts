import * as core from '@actions/core'
import {context, getOctokit} from '@actions/github'

export class PlanDiff {
  constructor(
    public added_labels = new Array<string>(),
    public added_workflows = new Array<string>(),
    public deleted_labels = new Array<string>(),
    public deleted_workflows = new Array<string>()
  ) {}
}

export class Plan {
  public label_workflows = new Map<string, Array<string>>()
  public labels = new Set<string>()
  public workflows = new Set<string>()
  public timestamp = new Date()

  calculate_diff(pre: Plan): PlanDiff {
    const added_labels = [...this.labels].filter(x => !pre.labels.has(x))
    const added_workflows = [...this.workflows].filter(
      x => !pre.workflows.has(x)
    )
    const deleted_labels = [...pre.labels].filter(x => !this.labels.has(x))
    const deleted_workflows = [...pre.workflows].filter(
      x => !this.workflows.has(x)
    )
    return new PlanDiff(
      added_labels,
      added_workflows,
      deleted_labels,
      deleted_workflows
    )
  }

  static parse(body: string): Plan {
    const label_workflows = new Map<string, Array<string>>()
    const plan = new Plan()

    const re = new RegExp(/-\s+\[([\s|x])\]\s+(.*)[\r\n]((\s\s-.*yml[\r\n])*)/g)
    let match = re.exec(body)
    while (match) {
      const mark = match[1]
      const label = match[2]
      const w = match[3]
        .split('\n')
        .map(x => {
          const re = new RegExp(/-\s(.*yml)/g)
          const match = re.exec(x)
          if (!match) {
            return ''
          }
          return match[1]
        })
        .filter(item => item != '')

      if (mark == 'x') {
        if (!label_workflows.has(label)) {
          label_workflows.set(label, new Array<string>())
        }
        for (const wf of w) {
          label_workflows.get(label)?.push(wf)
          plan.workflows.add(wf)
        }
      }
      match = re.exec(body)
    }

    plan.label_workflows = label_workflows
    return plan
  }
}
export class Context {
  private populated = false

  public actor = ''
  public ciflow_role = ''
  public comment_body_fixture = ''
  public comment_head_fixture = ''
  public event_name = ''
  public github!: ReturnType<typeof getOctokit>
  public github_head_ref = ''
  public github_sha = ''
  public owner = ''
  public pull_number = 0
  public repo = ''
  public repository = ''
  public strategy = ''

  async populate(): Promise<void> {
    if (this.populated) {
      return
    }

    this.repository = core.getInput('repository', {required: true})
    const [owner, repo] = this.repository.split('/')
    this.owner = owner
    this.repo = repo
    this.github = getOctokit(core.getInput('github-token', {required: true}))
    this.strategy = core.getInput('strategy')
    this.actor = context.actor
    this.ciflow_role = core.getInput('role', {required: true})
    this.event_name = context.eventName
    this.comment_head_fixture = core.getInput('comment-head-fixture', {
      required: true
    })
    this.comment_body_fixture = core.getInput('comment-body-fixture', {
      required: true
    })

    // only populate pull_request related
    if (context.payload.issue) {
      this.pull_number = context.payload.issue.number
      this.github_head_ref = process.env.GITHUB_HEAD_REF || ''
      this.github_sha = process.env.GITHUB_SHA || ''
    }

    this.populated = true
    core.debug(JSON.stringify(this))
  }
}

export class Comment {
  id = 0
  curr_body = ''
  curr_plan = new Plan()
  pre_body = ''
  pre_plan = new Plan()

  async update(ctx: Context): Promise<void> {
    ctx.github.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: this.id,
      body:
        this.curr_body +
        '\n----\n' +
        '```json\n' +
        JSON.stringify(
          {
            actor: ctx.actor,
            timestamp: new Date(),
            plan_diff: this.curr_plan.calculate_diff(this.pre_plan)
          },
          null,
          2
        ) +
        '\n```\n'
    })
  }

  async populate(ctx: Context): Promise<boolean> {
    if (!ctx.pull_number) {
      return false
    }

    const parameters = {
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.pull_number
    }

    for await (const {data: comments} of ctx.github.paginate.iterator(
      ctx.github.issues.listComments,
      parameters
    )) {
      // Search each page for the comment
      const comment = comments.find(comment => {
        return comment.body.includes(ctx.comment_head_fixture)
      })
      if (comment) {
        this.id = comment.id
        this.curr_body = comment.body
        this.curr_plan = Plan.parse(this.curr_body)
        this.pre_body = context.payload.comment?.body.from
        this.pre_plan = Plan.parse(this.pre_body)
        return true
      }
    }
    return false
  }

  async create(ctx: Context): Promise<void> {
    if (!ctx.pull_number) {
      return
    }

    const c = await ctx.github.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.pull_number,
      body: ctx.comment_head_fixture + '\n' + ctx.comment_body_fixture
    })

    this.id = c.data.id
    this.curr_body = c.data.body
    this.curr_plan = Plan.parse(this.curr_body)
  }

  async dispatch(ctx: Context): Promise<void> {
    if (!ctx.pull_number) {
      return
    }

    let labels: Array<string>
    if (ctx.event_name == 'issue_comment') {
      labels = this.curr_plan.calculate_diff(this.pre_plan).added_labels
    } else {
      labels = [...this.curr_plan.labels]
    }

    await ctx.github.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.pull_number,
      labels: labels
    })

    await Promise.all(
      labels.map(label =>
        ctx.github.issues.removeLabel({
          owner: ctx.owner,
          repo: ctx.repo,
          issue_number: ctx.pull_number,
          name: label
        })
      )
    )

    await this.update(ctx)
  }
}

export class CIFlowDispatcher {
  constructor(public ctx: Context = new Context()) {}

  async dispatch_comment(): Promise<void> {
    const comment = new Comment()
    const found = await comment.populate(this.ctx)
    if (!found) {
      await comment.create(this.ctx)
      await comment.dispatch(this.ctx)
      return
    }

    if (context.payload.comment?.id != comment.id) {
      return
    }
    await comment.dispatch(this.ctx)
  }

  async main(): Promise<void> {
    await this.ctx.populate()
    switch (this.ctx.strategy) {
      case 'comment': {
        await this.dispatch_comment()
        break
      }
      default: {
        throw new Error(`unsupported strategy: ${this.ctx.strategy}`)
      }
    }
  }
}

export class CIFlowListener {
  constructor(public ctx: Context = new Context()) {}

  async main(): Promise<void> {
    await this.ctx.populate()
  }
}

export class CIFlow {
  constructor(public ctx: Context = new Context()) {}

  async main(): Promise<void> {
    await this.ctx.populate()
    switch (this.ctx.ciflow_role) {
      case 'dispatcher':
        new CIFlowDispatcher(this.ctx).main()
        break
      case 'listener':
        new CIFlowListener(this.ctx).main()
        break
      default:
        throw new Error(`unsupported ciflow role ${this.ctx.ciflow_role}`)
    }
  }
}
