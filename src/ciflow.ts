import * as core from '@actions/core'
import {context, getOctokit} from '@actions/github'

// Context is the context to determine which workflows to dispatch

export class Plan {
  public label_workflows = new Map<string, Array<string>>()
  public workflows = new Set<string>()
  public rerun_workflows = new Array<string>()
  public timestamp = new Date()

  toJSON(): string {
    return JSON.stringify(this, null, 2)
  }
}
export class Context {
  private populated = false

  public plan = new Plan()
  public repository = ''
  public owner = ''
  public repo = ''
  public github!: ReturnType<typeof getOctokit>
  public comment_head = ''
  public comment_body = ''
  public github_head_ref = ''
  public pull_number = 0
  public github_sha = ''
  public strategy = ''
  public actor = ''
  public ciflow_role = ''

  async populate(): Promise<void> {
    if (this.populated) {
      return
    }

    this.repository = core.getInput('repository', {required: true})
    const [owner, repo] = this.repository.split('/')
    this.owner = owner
    this.repo = repo
    this.github = getOctokit(core.getInput('github-token', {required: true}))
    this.comment_head = core.getInput('comment-head', {required: true})
    this.comment_body = core.getInput('comment-body', {required: true})
    this.strategy = core.getInput('strategy')
    this.actor = context.actor
    this.ciflow_role = core.getInput('role', {required: true})

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
  body = ''

  parse(ctx: Context, body: string): void {
    const re = new RegExp(/-\s+\[([\s|x])\]\s+(.*)[\r\n]((\s\s-.*yml[\r\n])*)/g)
    let match = re.exec(body)
    const label_workflows = new Map<string, Array<string>>()
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
          ctx.plan.workflows.add(wf)
        }
      }
      match = re.exec(body)
    }

    ctx.plan.label_workflows = label_workflows
  }

  async update(ctx: Context): Promise<void> {
    ctx.github.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: this.id,
      body:
        this.body +
        '\n----\n' +
        '```json\n' +
        JSON.stringify(
          {
            actor: ctx.actor,
            timestamp: new Date(),
            label_workflows: ctx.plan.label_workflows,
            rerun_workflows: ctx.plan.rerun_workflows
          },
          null,
          2
        ) +
        '\n```\n'
    })
  }

  async find(ctx: Context): Promise<boolean> {
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
        return comment.body.includes(ctx.comment_head)
      })
      if (comment) {
        this.id = comment.id
        this.body = comment.body
        return true
      }
    }
    return false
  }

  async create(ctx: Context): Promise<void> {
    if (!ctx.pull_number) {
      return
    }

    ctx.github.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.pull_number,
      body: ctx.comment_head + '\n' + ctx.comment_body
    })
  }

  async dispatch(ctx: Context): Promise<void> {
    this.parse(ctx, this.body)
    const labels = [...ctx.plan.label_workflows.keys()]

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
    const found = await comment.find(this.ctx)
    if (!found) {
      comment.create(this.ctx)
      return
    }

    if (context.payload.comment?.id != comment.id) {
      return
    }
    comment.dispatch(this.ctx)
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
