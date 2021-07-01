import * as core from '@actions/core'
import {context, getOctokit} from '@actions/github'

// Context is the context to determine which workflows to dispatch
export class Context {
  public repository = ''
  public owner = ''
  public repo = ''
  public github!: ReturnType<typeof getOctokit>
  public comment_head = ''
  public comment_body = ''
  public branch = ''
  public pull_number = 0
  public commit_sha = ''
  public strategy = ''

  async populate(): Promise<void> {
    this.repository = core.getInput('repository', {required: true})
    const [owner, repo] = this.repository.split('/')
    this.owner = owner
    this.repo = repo
    this.github = getOctokit(core.getInput('github-token', {required: true}))
    this.comment_head = core.getInput('comment-head', {required: true})
    this.comment_body = core.getInput('comment-body', {required: true})
    this.strategy = core.getInput('strategy')

    // only populate pull_request related
    if (context.payload.issue) {
      this.pull_number = context.payload.issue.number
      const pr = await this.github.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.pull_number
      })
      this.branch = pr.data.head.ref
      this.commit_sha = pr.data.head.sha
    }

    core.debug(JSON.stringify(this))
  }
}

export class Workflow {
  constructor(public workflow_id: string = '') {}

  async rerun(ctx: Context): Promise<boolean> {
    const runs = await ctx.github.actions.listWorkflowRuns({
      owner: ctx.owner,
      repo: ctx.repo,
      branch: ctx.branch,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error workflow_id can be a string from github rest api
      workflow_id: this.workflow_id
    })

    // if we found exisiting running workflow, only rerun after checking the
    // the status of it
    if (runs?.data?.workflow_runs.length != 0) {
      const lastRun = runs?.data.workflow_runs[0]
      if (lastRun?.conclusion == 'skipped') {
        ctx.github.actions.reRunWorkflow({
          owner: ctx.owner,
          repo: ctx.repo,
          run_id: lastRun.id
        })
        return true
      } else {
        return false
      }
    }

    return false
  }
}

export class Comment {
  id = 0
  body = ''
  label_workflows = new Map<string, Array<string>>()
  workflows = new Set<string>()
  rerun_workflows = new Array<string>()

  parse(body: string): void {
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
          this.workflows.add(wf)
        }
      }
      match = re.exec(body)
    }

    this.label_workflows = label_workflows
  }

  async update(ctx: Context): Promise<void> {
    ctx.github.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: this.id,
      body:
        this.body +
        '\n\n```json\n' +
        JSON.stringify(
          {
            label_workflows: this.label_workflows,
            rerun_workflows: this.rerun_workflows
          },
          null,
          2
        ) +
        '```\n' +
        '----\n'
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
    this.parse(this.body)

    await ctx.github.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.pull_number,
      labels: [...this.label_workflows.keys()]
    })

    for (const wf of this.workflows) {
      const workflow = new Workflow(wf)
      const rerun = await workflow.rerun(ctx)
      if (rerun) {
        this.rerun_workflows.push(wf)
      }
    }
    await this.update(ctx)
  }
}

export class CIFlow {
  ctx: Context = new Context()

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
