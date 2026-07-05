# Migrating from `@ipregistry/client` to `@ipregistry/next`

`@ipregistry/next` is a Next.js integration layer **on top of** the official JavaScript SDK, not a replacement. Keep using `@ipregistry/client` directly for batch lookups, ASN lookups, user-agent parsing, and background jobs. Use `@ipregistry/next` for everything tied to an incoming request.

## Before

Typical hand-rolled setup with the SDK in a route handler:

```ts
import { InMemoryCache, IpregistryClient } from '@ipregistry/client'
import { NextResponse, type NextRequest } from 'next/server'

const client = new IpregistryClient({
    apiKey: process.env.IPREGISTRY_API_KEY!,
    cache: new InMemoryCache(),
})

export async function GET(request: NextRequest) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

    if (!ip) {
        return NextResponse.json({ country: null })
    }

    try {
        const response = await client.lookupIp(ip, { fields: 'location' })
        return NextResponse.json({
            country: response.data.location?.country?.code ?? null,
        })
    } catch {
        return NextResponse.json({ country: null })
    }
}
```

Problems this leaves you with: no IP validation or trusted-proxy handling, private IPs sent to the API (wasted calls), lookups duplicated in every route that needs the data, error handling repeated everywhere, and no way to use the data in middleware decisions.

## After

```ts
// middleware.ts — one lookup per request, cached, validated, fail-open
import { createIpregistryMiddleware } from '@ipregistry/next/middleware'

export const middleware = createIpregistryMiddleware({
    fields: 'ip,location',
})
```

```ts
// app/api/geo/route.ts
import { getIpregistry } from '@ipregistry/next'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
    const { data } = await getIpregistry(request)
    return NextResponse.json({
        country: data?.location?.country?.code ?? null,
    })
}
```

## Mapping

| With `@ipregistry/client` | With `@ipregistry/next` |
|---|---|
| `new IpregistryClient({ apiKey })` per module | Configured once in `createIpregistryMiddleware` (or via `IPREGISTRY_API_KEY`) |
| Manual `x-forwarded-for` parsing | `ipSource` presets ('vercel', 'cloudflare', 'nginx', custom) with validation |
| `client.lookupIp(ip, { fields })` in each handler | One middleware lookup; `getIpregistry()` anywhere |
| `new InMemoryCache()` wiring | On by default; same `IpregistryCache` interface for custom stores |
| `try/catch` around every lookup | Fail-open by default; `context.error` carries the SDK error code |
| `UserAgents.isBot(ua)` | `isBot(request)` (same heuristic underneath) |
| `response.data.location.in_eu` checks | `isEuVisitor(context)` |
| `response.data.security.is_*` checks | `isThreat(context, options)`, `blockThreats(options)` |

## What stays on `@ipregistry/client`

- `batchLookupIps`, `batchLookupAsns`
- `lookupAsn`, `originLookupIp`, `originLookupAsn`
- `parseUserAgents`
- Any lookup not tied to the current visitor (cron jobs, imports, data pipelines)

The SDK is a dependency of `@ipregistry/next`, so you can import both from the same install, and all response types (`IpInfo`, `Security`, `Location`, ...) are the SDK's own — data returned by `getIpregistry` is type-compatible with everything you already wrote against the SDK.
