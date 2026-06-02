import { buildQueries } from './queries.js'
import { searchOne } from './search.js'
import { buildIndexedArticles, toSourceRefs } from './sources.js'
import { synthesize } from './synthesize.js'
import { ClientError, Render, ServerError } from '@renderinc/sdk'
import type { ResearchEvent, SearchResult } from '../../shared/types.js'

const serviceSlug = process.env.WORKFLOW_SERVICE_SLUG ?? 'your-service-slug'
const pollMs = parseInt(process.env.WORKFLOW_POLL_MS ?? '1500', 10)
const render = new Render()

async function waitForSearchTask(taskRunId: string): Promise<SearchResult> {
  while (true) {
    const details = await render.workflows.getTaskRun(taskRunId)
    if (details.status === 'completed') {
      const result = details.results?.[0] as SearchResult | undefined
      if (!result) throw new Error('searchOne returned no result')
      return result
    }
    if (details.status === 'failed' || details.status === 'canceled') {
      throw new Error(details.error ?? `searchOne ${details.status}`)
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

export async function research(
  query: string,
  onEvent: (e: ResearchEvent) => void
): Promise<string> {
  const searches = buildQueries(query)
  onEvent({
    type: 'started',
    query,
    queries: searches.map((s) => s.query),
  })

  const results = await Promise.all(
    searches.map(async (spec, index) => {
      onEvent({ type: 'search:running', index })
      try {
        const started = await render.workflows.startTask(
          `${serviceSlug}/searchOne`,
          [query, spec, index],
        )
        const result = await waitForSearchTask(started.taskRunId)
        onEvent({ type: 'search:done', index, articleCount: result.articles.length })
        return result
      } catch (err) {
        let msg = String(err)
        if ((err instanceof ClientError || err instanceof ServerError) && err.response) {
          msg = `${err.message} — ${JSON.stringify(err.response)}`
        }
        onEvent({ type: 'search:failed', index, error: msg })
        throw err
      }
    })
  )

  onEvent({ type: 'sources', sources: toSourceRefs(buildIndexedArticles(results)) })
  onEvent({ type: 'synthesizing', message: 'All searches complete. Starting synthesis…' })
  const memo = await synthesize(query, results, (update) => {
    if (update.message) onEvent({ type: 'synthesizing', message: update.message })
    if (update.delta) onEvent({ type: 'synthesis:chunk', delta: update.delta })
  })
  onEvent({ type: 'done', memo })
  return memo
}
