/*
 * Copyright 2026 Ipregistry (https://ipregistry.co).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { NextResponse, type NextRequest } from 'next/server.js'
import { UserAgents, type IpregistryClient } from '@ipregistry/client'

import type { IpregistryAction } from './actions.js'
import { encodeContext } from './codec.js'
import {
    createIpregistryClient,
    toErrorInfo,
    type IpregistryConnectionOptions,
} from './config.js'
import {
    anonymizeIp,
    createIpExtractor,
    isPrivateIp,
    type IpSource,
} from './ip.js'
import {
    IPREGISTRY_HEADER,
    type IpregistryContext,
    type IpregistryLookupContext,
    type IpregistrySkipReason,
} from './types.js'

/**
 * Configuration of the Ipregistry middleware. Everything is optional: with
 * no configuration the middleware reads the API key from
 * `IPREGISTRY_API_KEY`, extracts the client IP from standard proxy headers,
 * caches lookups in memory, skips static assets, and fails open.
 */
export interface IpregistryMiddlewareConfig extends IpregistryConnectionOptions {
    /**
     * Selects the Ipregistry response fields to fetch and attach to the
     * request, as a comma-separated list (e.g. 'location,security'). Fewer
     * fields mean smaller headers and faster requests. Defaults to
     * `process.env.IPREGISTRY_FIELDS`, then to the full response.
     */
    fields?: string

    /**
     * Whether to resolve the hostname of the client IP. Defaults to false.
     */
    hostname?: boolean

    /**
     * Where to read the client IP from: a trusted-proxy preset ('auto',
     * 'cloudflare', 'vercel', 'nginx', 'forwarded-for'), a single trusted
     * header (`{ header: 'x-client-ip' }`), or a custom extractor function.
     * Only configure headers your proxy actually overwrites, otherwise
     * clients can spoof their IP. Defaults to 'auto'.
     */
    ipSource?: IpSource

    /**
     * A fixed IP address used when the extracted client IP is missing or
     * private, which is the norm on localhost. Handy in development to
     * exercise geo features; leave unset in production.
     */
    developmentIp?: string

    /**
     * Whether to skip lookups for static assets (`/_next/*`, favicon, and
     * common file extensions). Defaults to true so assets never consume
     * credits; set to false if your middleware matcher already excludes
     * them or you want assets enriched too.
     */
    skipStaticAssets?: boolean

    /**
     * Whether to skip lookups for search bots and crawlers, identified by
     * user agent. Pass true to use the SDK's built-in heuristic, or a
     * regular expression tested against the User-Agent header. Defaults to
     * false.
     */
    skipBots?: boolean | RegExp

    /**
     * A custom predicate deciding whether to skip the lookup for a request.
     * Runs after the static-asset and bot checks.
     */
    skip?: (request: NextRequest) => boolean

    /**
     * Decision hooks (`blockCountries`, `blockThreats`, `redirectByCountry`,
     * or your own) evaluated in order after a successful lookup. The first
     * action returning a response ends the request.
     */
    actions?: IpregistryAction[]

    /**
     * When the lookup fails (timeout, API error, missing key), the
     * middleware fails open by default: the request proceeds without data.
     * Set to true to respond with 503 instead, or to a number to choose the
     * status. Skipped lookups (static assets, bots, no IP) are unaffected.
     */
    failClosed?: boolean | number

    /**
     * Called when a lookup fails, before the fail-open/fail-closed decision.
     * Use it to report to your monitoring. The library itself never logs
     * full IP addresses; do the same in your handler.
     */
    onError?: (error: unknown, request: NextRequest) => void

    /**
     * Whether to log skipped and failed lookups with `console.warn`
     * (IP addresses are anonymized). Defaults to false.
     */
    debug?: boolean
}

const STATIC_EXTENSIONS =
    /\.(?:avif|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|otf|pdf|png|svg|ttf|txt|wasm|webm|webp|woff2?|xml)$/i

function isStaticAssetPath(pathname: string): boolean {
    return (
        pathname.startsWith('/_next/') ||
        pathname === '/favicon.ico' ||
        STATIC_EXTENSIONS.test(pathname)
    )
}

/**
 * Creates a Next.js middleware that enriches matched requests with
 * Ipregistry data. The result is attached to the request as the
 * `x-ipregistry` header and read back anywhere on the server with
 * `getIpregistry` — server components, route handlers, and
 * `getServerSideProps` all see it.
 *
 * ```ts
 * // middleware.ts
 * import { createIpregistryMiddleware } from '@ipregistry/next/middleware'
 *
 * export const middleware = createIpregistryMiddleware({
 *     fields: 'location,security',
 * })
 *
 * export const config = {
 *     matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
 * }
 * ```
 */
export function createIpregistryMiddleware(
    config: IpregistryMiddlewareConfig = {},
): (request: NextRequest) => Promise<NextResponse | Response> {
    const extractIp = createIpExtractor(config.ipSource)
    const fields = config.fields ?? process.env.IPREGISTRY_FIELDS
    const actions = config.actions ?? []

    // The client is created on first request, not at module evaluation, so
    // that a missing API key surfaces as a per-request fail-open error
    // instead of breaking the whole middleware at build/boot time.
    let client: IpregistryClient | undefined

    return async function ipregistryMiddleware(
        request: NextRequest,
    ): Promise<NextResponse | Response> {
        const skipped = resolveSkipReason(request, config)

        if (skipped) {
            return continueWith(request, { ip: null, data: null, skipped })
        }

        let ip = extractIp(request)

        if ((!ip || isPrivateIp(ip)) && config.developmentIp) {
            ip = config.developmentIp
        }

        if (!ip || isPrivateIp(ip)) {
            if (config.debug) {
                console.warn(
                    '[ipregistry] no public client IP found, skipping lookup',
                )
            }
            return continueWith(request, {
                ip: null,
                data: null,
                skipped: 'no-ip',
            })
        }

        let context: IpregistryContext

        try {
            client ??= createIpregistryClient(config)
            const response = await client.lookupIp(ip, {
                ...(fields !== undefined ? { fields } : {}),
                ...(config.hostname !== undefined
                    ? { hostname: config.hostname }
                    : {}),
            })
            context = { ip, data: response.data }
        } catch (error) {
            config.onError?.(error, request)

            if (config.debug) {
                console.warn(
                    `[ipregistry] lookup failed for ${anonymizeIp(ip)}:`,
                    error instanceof Error ? error.message : error,
                )
            }

            if (config.failClosed) {
                return new NextResponse('Service temporarily unavailable.', {
                    status:
                        typeof config.failClosed === 'number'
                            ? config.failClosed
                            : 503,
                    headers: { 'content-type': 'text/plain; charset=utf-8' },
                })
            }

            context = { ip, data: null, error: toErrorInfo(error) }
        }

        if (context.data) {
            for (const action of actions) {
                const response = await action(
                    context as IpregistryLookupContext,
                    request,
                )

                if (response) {
                    return response
                }
            }
        }

        return continueWith(request, context)
    }
}

function resolveSkipReason(
    request: NextRequest,
    config: IpregistryMiddlewareConfig,
): IpregistrySkipReason | null {
    const pathname = request.nextUrl.pathname

    if (config.skipStaticAssets !== false && isStaticAssetPath(pathname)) {
        return 'static-asset'
    }

    if (config.skipBots) {
        const userAgent = request.headers.get('user-agent')

        if (userAgent) {
            const isBot =
                config.skipBots instanceof RegExp
                    ? config.skipBots.test(userAgent)
                    : UserAgents.isBot(userAgent)

            if (isBot) {
                return 'bot'
            }
        }
    }

    if (config.skip?.(request)) {
        return 'custom'
    }

    return null
}

/**
 * Forwards the request with the Ipregistry context attached as a request
 * header. Any incoming `x-ipregistry` header is always discarded first so
 * clients can never spoof lookup data.
 */
function continueWith(
    request: NextRequest,
    context: IpregistryContext,
): NextResponse {
    const headers = new Headers(request.headers)
    headers.delete(IPREGISTRY_HEADER)
    headers.set(IPREGISTRY_HEADER, encodeContext(context))

    return NextResponse.next({ request: { headers } })
}

export {
    blockCountries,
    blockThreats,
    redirectByCountry,
    type BlockCountriesOptions,
    type BlockThreatsOptions,
    type IpregistryAction,
    type RedirectByCountryOptions,
} from './actions.js'
export { isBot, isEuVisitor, isThreat, type ThreatOptions } from './guards.js'
export type { IpregistryConnectionOptions } from './config.js'
export type { IpExtractor, IpSource, TrustedProxyPreset } from './ip.js'
export {
    IPREGISTRY_HEADER,
    type IpregistryContext,
    type IpregistryErrorInfo,
    type IpregistryLookupContext,
    type IpregistrySkipReason,
} from './types.js'
