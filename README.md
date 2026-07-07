[<img src="https://cdn.ipregistry.co/icons/favicon-96x96.png" alt="Ipregistry" width="64"/>](https://ipregistry.co/)

# Ipregistry Next.js Library

[![License](http://img.shields.io/:license-apache-blue.svg)](LICENSE.txt)
[![Actions Status](https://github.com/ipregistry/ipregistry-next/workflows/CI/badge.svg)](https://github.com/ipregistry/ipregistry-next/actions)
[![npm](https://img.shields.io/npm/v/@ipregistry/next.svg)](https://www.npmjs.com/package/@ipregistry/next)

This is the official Next.js integration for the [Ipregistry](https://ipregistry.co) IP geolocation and threat data API. It is built on top of the official [`@ipregistry/client`](https://github.com/ipregistry/ipregistry-javascript) JavaScript SDK.

The middleware enriches every incoming request with Ipregistry data. That data is then available anywhere on the server with a single call: server components, route handlers, server actions, and `getServerSideProps`. Both the Edge and Node.js runtimes are supported, in the App Router and the Pages Router.

```
Request -> middleware (1 lookup, cached) -> x-ipregistry request header -> getIpregistry() anywhere
```

## Features

- One middleware, data everywhere: a single lookup per request, readable from any server context.
- Built-in caching through the SDK's LRU cache, so repeated visits from the same IP do not consume additional credits.
- Country blocking, threat/proxy/Tor blocking, and country redirects as composable one-line actions.
- GDPR helper (`isEuVisitor`) based on the API's `location.in_eu` field.
- Safe by default: fails open when Ipregistry is unreachable, skips static assets, strips spoofed headers, never calls the API from the browser, and never logs full IP addresses.
- Trusted-proxy IP extraction presets for Vercel, Cloudflare, and Nginx, plus custom extractors.
- TypeScript-first, with the official SDK's response types re-exported.

## Getting started

You need an Ipregistry API key. Sign up at [https://ipregistry.co](https://ipregistry.co) to get one along with free lookups.

### Requirements

- Next.js 14 or newer
- Node.js 20 or newer, or the Edge runtime

### Installation

```sh
npm install @ipregistry/next
```

### Setup in three steps

Step 1: configure your API key. Never expose it client-side, so only use `IPREGISTRY_API_KEY` and never a `NEXT_PUBLIC_` variable:

```sh
# .env.local
IPREGISTRY_API_KEY=YOUR_API_KEY
```

Step 2: create the middleware:

```ts
// middleware.ts (next to your app/ directory)
import { createIpregistryMiddleware } from '@ipregistry/next/middleware'

export const middleware = createIpregistryMiddleware({
    fields: 'ip,location,security', // fetch only what you need
})

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

Step 3: read the data anywhere on the server:

```tsx
// app/page.tsx (server component)
import { getIpregistry } from '@ipregistry/next'

export default async function Page() {
    const { data } = await getIpregistry()

    return <h1>Hello {data?.location?.country?.name ?? 'visitor'}!</h1>
}
```

```ts
// app/api/geo/route.ts (route handler)
import { getIpregistry } from '@ipregistry/next'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
    const { data } = await getIpregistry(request)

    return NextResponse.json({
        country: data?.location?.country?.code ?? null,
        city: data?.location?.city ?? null,
    })
}
```

```ts
// Pages Router (getServerSideProps)
import { getIpregistry } from '@ipregistry/next'
import type { GetServerSideProps } from 'next'

export const getServerSideProps: GetServerSideProps = async ({ req }) => {
    const { data } = await getIpregistry(req)
    return { props: { country: data?.location?.country?.name ?? null } }
}
```

`getIpregistry` never throws and never triggers an API call. It returns an `IpregistryContext`:

```ts
interface IpregistryContext {
    ip: string | null       // the visitor IP the lookup ran for
    data: IpInfo | null     // the official SDK's IpInfo type
    skipped?: 'static-asset' | 'bot' | 'custom' | 'no-ip' | 'no-middleware'
    error?: { code?: string; message: string }
}
```

## Configuration

Everything is optional. Explicit options take precedence over environment variables.

| Option | Environment variable | Default | Description |
|---|---|---|---|
| `actions` | None | `[]` | Decision hooks run after a successful lookup. |
| `apiKey` | `IPREGISTRY_API_KEY` | None | Your Ipregistry API key (server-side only). |
| `baseUrl` | `IPREGISTRY_BASE_URL` | default endpoint | API base URL; `'eu'` selects the EU endpoint. |
| `cache` | None | `InMemoryCache` | Any SDK `IpregistryCache`, or `false` to disable. |
| `client` | None | None | A pre-configured `IpregistryClient` (advanced/testing). |
| `debug` | None | `false` | Log skips and failures with anonymized IPs. |
| `developmentIp` | None | None | Fixed IP used when the client IP is private (localhost). |
| `failClosed` | None | `false` | Respond 503 (or a custom status) when the lookup fails. |
| `fields` | `IPREGISTRY_FIELDS` | full response | Comma-separated field selection, e.g. `'ip,location,security'`. |
| `ipSource` | None | `'auto'` | Where to read the client IP from (see below). |
| `maxRetries` | None | `0` | Automatic retries. Off by default because retrying inside middleware would stall page loads. |
| `onError` | None | None | Callback for lookup failures (monitoring). |
| `skip` | None | None | Custom predicate to skip a request. |
| `skipBots` | None | `false` | Skip crawlers: `true` (SDK heuristic) or a custom `RegExp`. |
| `skipStaticAssets` | None | `true` | Skip `/_next/*`, favicon, and common asset extensions. |
| `timeout` | `IPREGISTRY_TIMEOUT` | `3000` | Lookup timeout in milliseconds. |

> Tip: set `fields` to fetch only what you use, keeping lookups fast and the request header small. `'ip,location,security'` covers geo features, blocking, and GDPR detection.

The context travels from the middleware to your app as a compact request header: JSON, deflate-compressed when large, base64url-encoded. A full unfiltered payload stays around 1 KB. The middleware warns once if the encoded value ever grows past 6 KB so you can trim `fields` before hitting proxy header limits.

## Country-based redirects

```ts
import {
    createIpregistryMiddleware,
    redirectByCountry,
} from '@ipregistry/next/middleware'

export const middleware = createIpregistryMiddleware({
    fields: 'ip,location',
    actions: [
        redirectByCountry({
            redirects: {
                FR: '/fr',                  // path on the same origin
                DE: 'https://example.de',   // or a country domain
            },
            preservePath: true, // /pricing -> /fr/pricing
        }),
    ],
})
```

Redirects are loop-safe: a visitor already under `/fr` (or already on `example.de`) is not redirected again. The default status is 307. Pass `status: 308` for permanent redirects.

## Blocking countries

```ts
import {
    blockCountries,
    createIpregistryMiddleware,
} from '@ipregistry/next/middleware'

export const middleware = createIpregistryMiddleware({
    fields: 'ip,location',
    actions: [
        blockCountries({ countries: ['KP', 'IR'] }), // 451 by default
    ],
})
```

Options: `mode: 'allow'` turns the list into an allowlist, `unknown: 'block'` also blocks visitors whose country could not be determined (the default is fail-open), and `response` lets you return a custom page.

## Blocking proxies, Tor, and threats

```ts
import {
    blockThreats,
    createIpregistryMiddleware,
} from '@ipregistry/next/middleware'

export const middleware = createIpregistryMiddleware({
    fields: 'ip,security',
    actions: [
        // Blocks security.is_threat / is_attacker / is_abuser by default.
        // Anonymization signals are opt-in:
        blockThreats({ proxy: true, tor: true, vpn: true }),
    ],
})
```

Each flag maps to the same-named `security.is_*` field of the Ipregistry response. You can also make ad-hoc decisions with a custom action:

```ts
export const middleware = createIpregistryMiddleware({
    fields: 'ip,location,security',
    actions: [
        (context, request) =>
            context.data.security.is_tor &&
            request.nextUrl.pathname.startsWith('/checkout')
                ? new Response('Not available over Tor.', { status: 403 })
                : undefined, // undefined = continue
    ],
})
```

Actions run in order after a successful lookup, and the first one returning a `Response` wins. They never run when the lookup was skipped or failed (fail-open).

## GDPR and EU detection

```tsx
import { getIpregistry, isEuVisitor } from '@ipregistry/next'

export default async function Layout({ children }) {
    const context = await getIpregistry()

    return (
        <>
            {children}
            {isEuVisitor(context) && <CookieConsentBanner />}
        </>
    )
}
```

`isEuVisitor` uses the API's `location.in_eu` field. When the data is missing it returns `false`. Pass `{ assumeEu: true }` to default to showing consent UIs instead:

```ts
isEuVisitor(context, { assumeEu: true })
```

## Caching

Lookups are cached by default with the SDK's `InMemoryCache` (LRU, 2048 entries, 10-minute expiry), scoped to the runtime instance. Repeated requests from the same IP consume a single credit until expiry. Plug any store by implementing the SDK's `IpregistryCache` interface:

```ts
import type { IpregistryCache } from '@ipregistry/client'
import { InMemoryCache } from '@ipregistry/client'

// Bigger cache with a 1-hour expiry:
createIpregistryMiddleware({ cache: new InMemoryCache(16384, 3_600_000) })

// Or your own (Redis, Valkey, ...):
class MyCache implements IpregistryCache { /* get/put/invalidate/invalidateAll */ }
createIpregistryMiddleware({ cache: new MyCache() })

// Or disable caching entirely:
createIpregistryMiddleware({ cache: false })
```

## IP extraction behind proxies

The visitor IP is read from proxy headers. Only trust headers your platform actually overwrites, otherwise clients can spoof their IP:

```ts
// Vercel
createIpregistryMiddleware({ ipSource: 'vercel' })

// Cloudflare (only trusts cf-connecting-ip)
createIpregistryMiddleware({ ipSource: 'cloudflare' })

// Nginx with `proxy_set_header X-Real-IP $remote_addr;`
createIpregistryMiddleware({ ipSource: 'nginx' })

// A single custom trusted header
createIpregistryMiddleware({ ipSource: { header: 'x-client-ip' } })

// Full control
createIpregistryMiddleware({
    ipSource: request => request.headers.get('x-my-edge-ip'),
})
```

The default (`'auto'`) reads `x-real-ip`, then the first `x-forwarded-for` entry. This is correct on Vercel, Cloudflare, and any well-configured reverse proxy. Extracted values are validated; ports, IPv6 brackets, and zone IDs are stripped; private and reserved addresses are never sent to the API.

On localhost your IP is private, so no lookup happens. To exercise geo features in development:

```ts
createIpregistryMiddleware({
    developmentIp: process.env.NODE_ENV === 'development' ? '66.165.2.7' : undefined,
})
```

## Saving credits on bots and static assets

Static assets (`/_next/*`, favicon, images, fonts, and similar) are always skipped by default. Search bots are skipped opt-in:

```ts
createIpregistryMiddleware({
    skipBots: true,               // SDK heuristic (bot, crawl, spider, slurp)
    // or a custom pattern:
    skipBots: /googlebot|bingbot|my-monitoring/i,
    // and any custom rule:
    skip: request => request.nextUrl.pathname.startsWith('/healthz'),
})
```

Your `matcher` in `middleware.ts` remains the primary filter. The built-in skips are a safety net.

## Error handling

The middleware fails open by default. If Ipregistry is unreachable, the request times out, the API key is missing or invalid, or the response is malformed, the request continues normally with `data: null` and an `error` on the context. Users are never blocked by an outage, no exception ever escapes into your request pipeline, and full IP addresses are never logged.

```ts
const context = await getIpregistry()

if (context.error) {
    // e.g. { code: 'INVALID_API_KEY', message: '...' }
    // codes: Ipregistry API codes, plus MISSING_API_KEY / CLIENT_ERROR
}
```

For security-sensitive apps that must not serve traffic without IP intelligence, opt into fail-closed:

```ts
createIpregistryMiddleware({
    failClosed: true,        // 503 on lookup failure
    // failClosed: 403,      // or pick the status
    onError: error => reportToMonitoring(error),
})
```

## Composing with existing middleware

```ts
// middleware.ts
import { createIpregistryMiddleware } from '@ipregistry/next/middleware'
import type { NextRequest } from 'next/server'

const withIpregistry = createIpregistryMiddleware({ fields: 'ip,location' })

export async function middleware(request: NextRequest) {
    const response = await withIpregistry(request)

    // Blocked or redirected by an action? Stop here.
    if (response.status !== 200 || response.headers.has('location')) {
        return response
    }

    // ... your own logic. Return `response` (not NextResponse.next())
    // so the Ipregistry request header keeps flowing to your app.
    return response
}
```

## API reference

From `@ipregistry/next`:

| Export | Description |
|---|---|
| `getIpregistry(source?)` | Reads the request's Ipregistry context. Call without arguments in server components and server actions; pass the request or headers elsewhere. Never throws, never calls the API. |
| `isEuVisitor(input, options?)` | Returns true when the visitor is in the European Union, based on `location.in_eu`. Accepts an `IpInfo` or an `IpregistryContext`. |
| `isThreat(input, options?)` | Returns true when the IP is flagged by `security.is_threat`, `is_attacker`, or `is_abuser`. Proxy, Tor, VPN, and relay signals are opt-in through the options. |
| `isBot(input)` | Returns true for bot user agents. Accepts a user agent string, a request, or a parsed SDK `UserAgent`. |
| `IPREGISTRY_HEADER` | The request header name (`x-ipregistry`) used to carry the context. |

Types: `IpregistryContext`, `IpregistryLookupContext`, `IpregistrySkipReason`, `IpregistryErrorInfo`, `ThreatOptions`, plus the SDK's `IpInfo`, `Location`, `Security`, `Connection`, `Company`, `Carrier`, `Currency`, `TimeZone`, and `UserAgent`.

From `@ipregistry/next/middleware` (includes everything above, plus):

| Export | Description |
|---|---|
| `createIpregistryMiddleware(config)` | Creates the middleware that performs the lookup and attaches the context to the request. |
| `blockCountries(options)` | Action that blocks (or exclusively allows) visitors by ISO 3166-1 country code. |
| `blockThreats(options)` | Action that blocks visitors flagged by Ipregistry security data. |
| `redirectByCountry(options)` | Action that redirects visitors to country-specific paths or domains, loop-safe. |

Types: `IpregistryMiddlewareConfig`, `IpregistryAction`, `BlockCountriesOptions`, `BlockThreatsOptions`, `RedirectByCountryOptions`, `IpSource`, `IpExtractor`, `TrustedProxyPreset`.

## Examples

Complete minimal setups live in [`examples/app-router`](./examples/app-router) and [`examples/pages-router`](./examples/pages-router).

## Migrating from `@ipregistry/client`

See [MIGRATION.md](./MIGRATION.md). In short: keep the SDK for batch, ASN, and user-agent lookups and for background jobs; use this package to enrich request handling. It removes the client wiring, IP extraction, caching, and error-handling boilerplate from your Next.js code.

## Other resources

- [API documentation](https://ipregistry.co/docs)
- [Issue tracker](https://github.com/ipregistry/ipregistry-next/issues)
- Email: support@ipregistry.co

## License

Apache License 2.0. See [LICENSE.txt](./LICENSE.txt).
