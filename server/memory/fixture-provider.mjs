// Deterministic mechanics-only test adapter; never used by the running app.
export const fixtureGrouping = async ({ passages, priorTopics }) => ({ groups: [{ title: 'Synthetic fixture evidence', continuationOf: priorTopics[0]?.id ?? null, sourceIds: passages.map(p => p.id) }], omissions: [] });
