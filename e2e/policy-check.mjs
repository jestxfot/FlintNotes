// Asks the list of who may do what (server/policy.ts) every question that matters, with no server: seconds.
//   node e2e/policy-check.mjs
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './helpers.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-policy-'))
const bundle = path.join(dir, 'policy.mjs')
await build({ entryPoints: [path.join(ROOT, 'server', 'policy.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' })
const { decide } = await import(bundle)
fs.rmSync(dir, { recursive: true, force: true })

const results = []
const ok = (name, passed, detail = '') => {
  results.push(passed)
  console.log(`${passed ? '✓' : '✗'} ${name}${passed ? '' : `\n    ${detail}`}`)
}
const may = (tier, method, path) => decide(tier, method, path).allowed
const TIERS = ['admin', 'shell', 'phone']

ok('the notes themselves are open to every tier, whatever the method', TIERS.every((tier) => ['GET', 'PUT', 'POST', 'DELETE'].every((method) => may(tier, method, '/api/tree') && may(tier, method, '/api/file') && may(tier, method, '/api/events'))))
ok('the server\'s own things (keys, proxy, the phone\'s channel) are the server\'s computer\'s alone', ['/api/phone', '/api/shell', '/api/proxy', '/api/proxy/test', '/api/notify', '/api/notify/test'].every((p) => ['GET', 'POST'].every((m) => may('admin', m, p) && !may('shell', m, p) && !may('phone', m, p))))
ok('the window runs the owner\'s programs, a phone does not', may('admin', 'POST', '/api/exec') && may('shell', 'POST', '/api/exec') && !may('phone', 'POST', '/api/exec'))
ok('a look-alike address is not the program route', may('phone', 'GET', '/api/executive-summary') && may('phone', 'GET', '/api/system-commands'))
ok('which folders are vaults is the server computer\'s: the window and phones neither forget a vault nor look through folders, but may read the list', TIERS.every((tier) => may(tier, 'GET', '/api/vaults')) && ['shell', 'phone'].every((tier) => !may(tier, 'POST', '/api/vaults/forget') && !may(tier, 'DELETE', '/api/vaults/forget') && !may(tier, 'GET', '/api/dirs')) && may('admin', 'POST', '/api/vaults/forget') && may('admin', 'GET', '/api/dirs'))
ok('methods are told in any case', !may('phone', 'post', '/api/exec') && may('shell', 'post', '/api/exec'))
ok('a refusal says why, in words', decide('phone', 'POST', '/api/exec').message.length > 10 && decide('shell', 'POST', '/api/phone').message.length > 10)

const failed = results.filter((passed) => !passed).length
console.log(failed ? `\n${failed} из ${results.length} проверок не прошли` : `\nВсе ${results.length} проверок прошли`)
process.exit(failed ? 1 : 0)
