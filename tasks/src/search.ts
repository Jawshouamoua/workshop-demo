import { task } from '@renderinc/sdk/workflows'
import { Exa } from 'exa-js'
import type { SearchResult } from '../../shared/types.js'
import type { SearchSpec } from './queries.js'

function getExa(): Exa {
  const key = process.env.EXA_API_KEY
  if (!key) throw new Error('EXA_API_KEY is not set')
  return new Exa(key)
}

// 30% chance of throwing. This is the workshop demo mechanism.
// With 4 parallel searches, around 76% of v1 runs fail (1 - 0.7^4).
// In v2, Workflows retries each search up to 3 times, lifting per-run
// success rate to around 90%. Same flaky code, totally different outcome.
function maybeFail(query: string) {
  if (Math.random() < 0.3) {
    throw new Error(`Exa rate limit hit on query: "${query}"`)
  }
}

export const searchOne = task({
    name: 'searchOne',
    plan: 'starter',
    timeoutSeconds: 120,
    retry: { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 1.5 },
  },
  async function searchOne(
    _topic: string,
    spec: SearchSpec,
    index: number,
  ): Promise<SearchResult> {
    maybeFail(spec.query)
    const exa = getExa()
    const response = await exa.searchAndContents(spec.query, {
      numResults: 5,
      text: true,
      startPublishedDate: spec.startPublishedDate,
    })
    return {
      index,
      query: spec.query,
      articles: response.results.map((r: (typeof response.results)[number]) => ({
        title: r.title ?? r.url,
        url: r.url,
        text: r.text ?? '',
        publishedDate: r.publishedDate,
      })),
    }
  }
)
