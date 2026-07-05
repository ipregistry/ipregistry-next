import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpregistryClient } from '@ipregistry/client'

import { decodeContext } from '../src/codec.js'
import {
    blockCountries,
    createIpregistryMiddleware,
    redirectByCountry,
} from '../src/middleware.js'
import { IPREGISTRY_HEADER } from '../src/types.js'
import { euIpInfo, ipInfo } from './fixtures.js'

const PUBLIC_IP = '66.165.2.7'

function stubClient(
    lookupIp: (...args: unknown[]) => unknown,
): IpregistryClient {
    return { lookupIp } as unknown as IpregistryClient
}

function okClient(data = ipInfo()) {
    return stubClient(async () => ({
        credits: { consumed: 1, remaining: 1000 },
        data,
        throttling: null,
    }))
}

function requestFor(
    url = 'https://example.com/pricing',
    headers: Record<string, string> = { 'x-real-ip': PUBLIC_IP },
): NextRequest {
    return new NextRequest(url, { headers })
}

/**
 * NextResponse.next({ request: { headers } }) exposes the forwarded request
 * headers as `x-middleware-request-*` response headers; that is how Next.js
 * itself transports them, and how tests can observe them.
 */
function forwardedContext(response: Response) {
    const value = response.headers.get(
        `x-middleware-request-${IPREGISTRY_HEADER}`,
    )
    return value ? decodeContext(value) : null
}

describe('createIpregistryMiddleware', () => {
    beforeEach(() => {
        vi.stubEnv('IPREGISTRY_API_KEY', '')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('attaches lookup data to the forwarded request', async () => {
        const middleware = createIpregistryMiddleware({ client: okClient() })
        const response = await middleware(requestFor())

        const context = await forwardedContext(response)
        expect(context?.ip).toBe(PUBLIC_IP)
        expect(context?.data?.location?.country?.code).toBe('US')
        expect(context?.skipped).toBeUndefined()
        expect(context?.error).toBeUndefined()
    })

    it('passes fields and hostname options through to the SDK', async () => {
        const lookupIp = vi.fn(async () => ({
            credits: { consumed: 1, remaining: null },
            data: ipInfo(),
            throttling: null,
        }))
        const middleware = createIpregistryMiddleware({
            client: stubClient(lookupIp),
            fields: 'location,security',
            hostname: true,
        })

        await middleware(requestFor())

        expect(lookupIp).toHaveBeenCalledWith(PUBLIC_IP, {
            fields: 'location,security',
            hostname: true,
        })
    })

    it('strips spoofed x-ipregistry headers from incoming requests', async () => {
        const middleware = createIpregistryMiddleware({ client: okClient() })
        const forged = requestFor('https://example.com/pricing', {
            'x-real-ip': PUBLIC_IP,
            [IPREGISTRY_HEADER]: 'forged-value',
        })

        const response = await middleware(forged)
        const context = await forwardedContext(response)

        expect(context?.data?.location?.country?.code).toBe('US')
    })

    it('strips spoofed headers even on skipped requests', async () => {
        const middleware = createIpregistryMiddleware({ client: okClient() })
        const response = await middleware(
            requestFor('https://example.com/logo.png', {
                [IPREGISTRY_HEADER]: 'forged-value',
            }),
        )

        const context = await forwardedContext(response)
        expect(context?.skipped).toBe('static-asset')
        expect(context?.data).toBeNull()
    })

    it('skips static assets by default and never calls the API', async () => {
        const lookupIp = vi.fn()
        const middleware = createIpregistryMiddleware({
            client: stubClient(lookupIp),
        })

        for (const url of [
            'https://example.com/_next/static/chunk.js',
            'https://example.com/favicon.ico',
            'https://example.com/hero.avif',
            'https://example.com/robots.txt',
        ]) {
            const response = await middleware(requestFor(url))
            expect((await forwardedContext(response))?.skipped).toBe(
                'static-asset',
            )
        }

        expect(lookupIp).not.toHaveBeenCalled()
    })

    it('can be configured to enrich static assets too', async () => {
        const middleware = createIpregistryMiddleware({
            client: okClient(),
            skipStaticAssets: false,
        })

        const response = await middleware(
            requestFor('https://example.com/hero.avif'),
        )
        expect((await forwardedContext(response))?.data).not.toBeNull()
    })

    it('skips bots when enabled', async () => {
        const lookupIp = vi.fn()
        const middleware = createIpregistryMiddleware({
            client: stubClient(lookupIp),
            skipBots: true,
        })

        const response = await middleware(
            requestFor('https://example.com/', {
                'x-real-ip': PUBLIC_IP,
                'user-agent':
                    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            }),
        )

        expect((await forwardedContext(response))?.skipped).toBe('bot')
        expect(lookupIp).not.toHaveBeenCalled()
    })

    it('supports a custom bot pattern', async () => {
        const middleware = createIpregistryMiddleware({
            client: okClient(),
            skipBots: /internal-probe/i,
        })

        const skippedResponse = await middleware(
            requestFor('https://example.com/', {
                'x-real-ip': PUBLIC_IP,
                'user-agent': 'Internal-Probe/1.0',
            }),
        )
        expect((await forwardedContext(skippedResponse))?.skipped).toBe('bot')

        const normalResponse = await middleware(requestFor())
        expect((await forwardedContext(normalResponse))?.data).not.toBeNull()
    })

    it('supports a custom skip predicate', async () => {
        const middleware = createIpregistryMiddleware({
            client: okClient(),
            skip: (request) => request.nextUrl.pathname.startsWith('/health'),
        })

        const response = await middleware(
            requestFor('https://example.com/healthz'),
        )
        expect((await forwardedContext(response))?.skipped).toBe('custom')
    })

    it('skips private and missing client IPs', async () => {
        const lookupIp = vi.fn()
        const middleware = createIpregistryMiddleware({
            client: stubClient(lookupIp),
        })

        const cases: Record<string, string>[] = [
            {},
            { 'x-real-ip': '192.168.1.10' },
            { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
        ]

        for (const headers of cases) {
            const response = await middleware(
                requestFor('https://example.com/', headers),
            )
            expect((await forwardedContext(response))?.skipped).toBe('no-ip')
        }

        expect(lookupIp).not.toHaveBeenCalled()
    })

    it('rejects an invalid developmentIp at configuration time', () => {
        expect(() =>
            createIpregistryMiddleware({ developmentIp: 'not-an-ip' }),
        ).toThrow(/developmentIp/)
    })

    it('warns once when the encoded payload risks header limits', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        try {
            const huge = ipInfo()
            // High-entropy padding so the payload stays large even after
            // the codec's deflate compression.
            let seed = 42
            let padding = ''
            while (padding.length < 32 * 1024) {
                seed = (seed * 1103515245 + 12345) % 2147483648
                padding += seed.toString(36)
            }
            // @ts-expect-error oversized synthetic payload
            huge.padding = padding

            const middleware = createIpregistryMiddleware({
                client: okClient(huge),
            })

            await middleware(requestFor())
            await middleware(requestFor())

            const headerWarnings = warn.mock.calls.filter((call) =>
                String(call[0]).includes('request-header limits'),
            )
            expect(headerWarnings).toHaveLength(1)
        } finally {
            warn.mockRestore()
        }
    })

    it('uses the development IP fallback for private addresses', async () => {
        const middleware = createIpregistryMiddleware({
            client: okClient(),
            developmentIp: PUBLIC_IP,
        })

        const response = await middleware(
            requestFor('https://example.com/', { 'x-real-ip': '127.0.0.1' }),
        )

        expect((await forwardedContext(response))?.ip).toBe(PUBLIC_IP)
    })

    it('fails open by default when the lookup fails', async () => {
        const onError = vi.fn()
        const middleware = createIpregistryMiddleware({
            client: stubClient(async () => {
                throw new Error('network down')
            }),
            onError,
        })

        const response = await middleware(requestFor())
        const context = await forwardedContext(response)

        expect(response.status).toBe(200)
        expect(context?.data).toBeNull()
        expect(context?.error?.message).toBe('network down')
        expect(onError).toHaveBeenCalledOnce()
    })

    it('fails closed when configured', async () => {
        const failing = stubClient(async () => {
            throw new Error('network down')
        })

        const middleware = createIpregistryMiddleware({
            client: failing,
            failClosed: true,
        })
        expect((await middleware(requestFor())).status).toBe(503)

        const customStatus = createIpregistryMiddleware({
            client: failing,
            failClosed: 429,
        })
        expect((await customStatus(requestFor())).status).toBe(429)
    })

    it('fails open with MISSING_API_KEY when no key is configured', async () => {
        const middleware = createIpregistryMiddleware()
        const response = await middleware(requestFor())

        const context = await forwardedContext(response)
        expect(response.status).toBe(200)
        expect(context?.error?.code).toBe('MISSING_API_KEY')
    })

    it('runs actions in order and short-circuits on the first response', async () => {
        const middleware = createIpregistryMiddleware({
            client: okClient(euIpInfo()),
            actions: [
                redirectByCountry({ redirects: { FR: '/fr' } }),
                blockCountries({ countries: ['FR'] }),
            ],
        })

        const response = await middleware(requestFor())
        expect(response.status).toBe(307)
        expect(response.headers.get('location')).toBe('https://example.com/fr')
    })

    it('does not run actions when the lookup failed (fail-open)', async () => {
        const action = vi.fn()
        const middleware = createIpregistryMiddleware({
            client: stubClient(async () => {
                throw new Error('boom')
            }),
            actions: [action],
        })

        const response = await middleware(requestFor())
        expect(response.status).toBe(200)
        expect(action).not.toHaveBeenCalled()
    })

    it('supports fully custom actions', async () => {
        const middleware = createIpregistryMiddleware({
            client: okClient(),
            actions: [
                (context, request) =>
                    context.data.security?.is_cloud_provider &&
                    request.nextUrl.pathname.startsWith('/app')
                        ? new Response('no cloud providers', { status: 403 })
                        : undefined,
            ],
        })

        const response = await middleware(requestFor())
        expect(response.status).toBe(200)
    })
})
