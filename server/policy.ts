// Who may ask for what.
//
// The server answers three tiers (see `Tier`): the server's own computer (`admin`), the Windows window (`shell`) and a phone
// (`phone`). What each may do used to be spread over two patterns and checks inside routes; here it is one list, read in order,
// the first rule that fits the request deciding. A request no rule names is open to every tier (that is the notes themselves).
//
// What depends on the data (which vaults are open, which roots there are) stays in the routes: a table cannot know it.
// Pure on purpose: no server, no config, so the whole list can be tested by asking it questions.

import type { Tier } from '../shared/protocol'

interface Rule {
  /** The address of the request, `/api/...`. */
  path: RegExp
  /** Only these methods are covered; none named: all of them. */
  methods?: readonly string[]
  /** The tiers that may. */
  tiers: readonly Tier[]
  /** What the one refused is told. */
  message: string
}

const NOT_NETWORK = 'Это делается только на самом сервере'
const NOT_PHONE = 'Это делается только на компьютере'
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE']

export const RULES: readonly Rule[] = [
  // What version the server is anyone may read, to tell it from a wrong address.
  { path: /^\/api\/server$/, methods: ['GET', 'HEAD'], tiers: ['admin', 'shell', 'phone'], message: '' },
  // What belongs to the server itself: its proxy, the keys, updating it.
  { path: /^\/api\/(proxy|phone|shell|server)(\/|$)/, tiers: ['admin'], message: NOT_NETWORK },
  // The programs the owner wrote into the server's config (Templater's system commands): the window's own, never a phone's.
  { path: /^\/api\/exec(\/|$)/, tiers: ['admin', 'shell'], message: NOT_PHONE },
  // Forgetting a vault, and looking through the server's folders to open one.
  { path: /^\/api\/vaults\/forget(\/|$)/, methods: WRITES, tiers: ['admin', 'shell'], message: NOT_PHONE },
  { path: /^\/api\/dirs(\/|$)/, tiers: ['admin', 'shell'], message: NOT_PHONE },
]

export type Decision = { allowed: true } | { allowed: false; message: string }

/** Whether `tier` may make this request. */
export function decide(tier: Tier, method: string, path: string): Decision {
  const verb = method.toUpperCase()
  for (const rule of RULES) {
    if (!rule.path.test(path) || (rule.methods && !rule.methods.includes(verb))) continue
    return rule.tiers.includes(tier) ? { allowed: true } : { allowed: false, message: rule.message }
  }
  return { allowed: true }
}
