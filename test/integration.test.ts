/**
 * End-to-end tests through the real @ipregistry/client SDK with the HTTP
 * layer mocked: middleware -> SDK -> (mock) API -> header -> getIpregistry.
 */
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getIpregistry } from '../src/get.js'
import { createIpregistryMiddleware } from '../src/middleware.js'
import { IPREGISTRY_HEADER } from '../src/types.js'
import { euIpInfo } from './fixtures.js'

const PUBLIC_IP = '2.2.2.2'

function apiResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

/**
 * Replays the middleware's forwarded request headers into a new request,
 * the same way Next.js forwards them to route handlers and pages.
 */
function replayForwardedRequest(response: Response): NextRequest {
    const value = response.headers.get(
        `x-middleware-request-${IPREGISTRY_HEADER}`,
    )
    return new NextRequest('https://example.com/page', {
        headers: value ? { [IPREGISTRY_HEADER]: value } : {},
    })
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

describe('middleware -> SDK -> getIpregistry integration', () => {
    it('enriches a request end to end', async () => {
        const fetchMock = vi.fn(
            async (input: RequestInfo | URL, init?: RequestInit) => {
                expect(String(input)).toContain(`/${PUBLIC_IP}`)
                expect(String(input)).toContain('fields=location%2Csecurity')
                expect(
                    (init?.headers as Record<string, string>).authorization,
                ).toBe('ApiKey test-key')
                return apiResponse(euIpInfo())
            },
        )
        vi.stubGlobal('fetch', fetchMock)

        const middleware = createIpregistryMiddleware({
            apiKey: 'test-key',
            fields: 'location,security',
        })

        const response = await middleware(
            new NextRequest('https://example.com/pricing', {
                headers: { 'x-real-ip': PUBLIC_IP },
            }),
        )

        const context = await getIpregistry(replayForwardedRequest(response))

        expect(context.ip).toBe(PUBLIC_IP)
        expect(context.data?.location?.country?.code).toBe('FR')
        expect(context.data?.location?.in_eu).toBe(true)
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('caches repeated lookups for the same IP', async () => {
        const fetchMock = vi.fn(async () => apiResponse(euIpInfo()))
        vi.stubGlobal('fetch', fetchMock)

        const middleware = createIpregistryMiddleware({ apiKey: 'test-key' })
        const request = () =>
            new NextRequest('https://example.com/pricing', {
                headers: { 'x-real-ip': PUBLIC_IP },
            })

        await middleware(request())
        await middleware(request())
        await middleware(request())

        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('reads the API key from the environment', async () => {
        vi.stubEnv('IPREGISTRY_API_KEY', 'env-key')
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, init?: RequestInit) => {
                expect(
                    (init?.headers as Record<string, string>).authorization,
                ).toBe('ApiKey env-key')
                return apiResponse(euIpInfo())
            },
        )
        vi.stubGlobal('fetch', fetchMock)

        const middleware = createIpregistryMiddleware()
        const response = await middleware(
            new NextRequest('https://example.com/', {
                headers: { 'x-real-ip': PUBLIC_IP },
            }),
        )

        expect(response.status).toBe(200)
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('fails open with the API error code when the API rejects', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                apiResponse(
                    {
                        code: 'INVALID_API_KEY',
                        message: 'The API key is invalid.',
                        resolution: 'Double-check your API key.',
                    },
                    403,
                ),
            ),
        )

        const middleware = createIpregistryMiddleware({ apiKey: 'bad-key' })
        const response = await middleware(
            new NextRequest('https://example.com/', {
                headers: { 'x-real-ip': PUBLIC_IP },
            }),
        )

        expect(response.status).toBe(200)

        const context = await getIpregistry(replayForwardedRequest(response))
        expect(context.data).toBeNull()
        expect(context.error?.code).toBe('INVALID_API_KEY')
    })

    it('fails open on network failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('fetch failed')
            }),
        )

        const middleware = createIpregistryMiddleware({ apiKey: 'test-key' })
        const response = await middleware(
            new NextRequest('https://example.com/', {
                headers: { 'x-real-ip': PUBLIC_IP },
            }),
        )

        expect(response.status).toBe(200)

        const context = await getIpregistry(replayForwardedRequest(response))
        expect(context.data).toBeNull()
        expect(context.error).toBeDefined()
    })
})
