import Anthropic from '@anthropic-ai/sdk'
import type { SearchResult } from '../../shared/types.js'
import { researchDates } from './dates.js'
import { formatSourcesForPrompt, buildIndexedArticles } from './sources.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type SynthesisProgress = {
  message?: string
  delta?: string
}

export async function synthesize(
  query: string,
  results: SearchResult[],
  onProgress?: (update: SynthesisProgress) => void
): Promise<string> {
  const { today, todayLabel } = researchDates()
  const indexed = buildIndexedArticles(results)
  const sources = formatSourcesForPrompt(indexed)

  onProgress?.({
    message: `Prepared ${indexed.length} articles from ${results.length} searches. Calling Claude…`,
  })

  const prompt = `Write a research memo on the following topic for an individual investor.

Topic: ${query}
Research as-of date (US Eastern): ${today} (${todayLabel})

Use this exact markdown structure:

# Research Memo

## Snapshot
Extract these from the sources. If a value is not in the sources, write "N/A". Do not invent numbers.
- **Current price (${todayLabel}):** $X.XX (change vs prior close if stated) — only use a figure explicitly tied to ${todayLabel} or ${today}; otherwise N/A
- **Market cap:** $X (same date rule as price)
- **P/E (trailing):** X
- **52-week range:** $X to $Y
- **Analyst target:** $X (N analysts)
- **Consensus rating:** Buy / Hold / Sell

## Summary
Two or three sentences. Lead with the most material point.

## Bull Case
Three bullets. Each one sentence. Cite sources inline with [N] only (numbered references, not URLs).

## Bear Case
Three bullets. Each one sentence. Cite sources inline with [N] only (numbered references, not URLs).

## Analyst Consensus
One paragraph. Reference the analyst target and rating from the Snapshot. Add color from any analyst commentary in the sources.

## Recent News
Two short paragraphs covering developments from ${todayLabel} or the last 24 hours only. Ignore older stories unless needed for one sentence of context. Cite specific dates and figures from sources.

## Competitive Position
One paragraph on market position and key peers.

## Sources
Omit this section: it is appended automatically as markdown links ([title](url) per cited source).

Rules:
- Terse, analytical tone. No marketing language. No phrases like "it is important to note."
- Do not invent numbers or dates. If a value is not in the sources, say "N/A".
- Sources are sorted newest-first. Prefer the newest published date for price and news.
- Never label a price as "${todayLabel}" or "today" unless the source text or Published date supports ${today} or ${todayLabel}. Older prices (e.g. from last week) are N/A for Snapshot price fields.
- If sources conflict, note the conflict and prefer the newest dated source.
- Never use em dashes. Use colons instead.
- This is NOT investment advice. Do not say buy/sell/hold yourself, only report what analysts said.

Sources:

${sources}`

  onProgress?.({ message: 'Claude is streaming the memo…' })

  let text = ''
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  })

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      text += event.delta.text
      onProgress?.({ delta: event.delta.text })
    }
  }

  if (!text) throw new Error('Claude returned an empty memo')
  return text
}

