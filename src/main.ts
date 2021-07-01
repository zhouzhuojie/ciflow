import * as core from '@actions/core'
import {CIFlow} from './ciflow'

process.on('unhandledRejection', handleError)
main().catch(handleError)

async function main(): Promise<void> {
  new CIFlow().main()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleError(err: any): void {
  console.error(err)
  core.setFailed(`Unhandled error: ${err}`)
}
