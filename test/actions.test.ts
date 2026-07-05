import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import {
    blockCountries,
    blockThreats,
    redirectByCountry,
} from '../src/actions.js'
import type { IpregistryLookupContext } from '../src/types.js'
import { euIpInfo, ipInfo } from './fixtures.js'

function contextFor(data = ipInfo()): IpregistryLookupContext {
    return { ip: data.ip, data }
}

const request = (url = 'https://example.com/pricing') => new NextRequest(url)

describe('blockCountries', () => {
    it('blocks listed countries', async () => {
        const action = blockCountries({ countries: ['us'] })
        const response = await action(contextFor(), request())

        expect(response?.status).toBe(451)
    })

    it('lets unlisted countries through', async () => {
        const action = blockCountries({ countries: ['KP', 'IR'] })
        expect(await action(contextFor(), request())).toBeUndefined()
    })

    it('supports allow mode', async () => {
        const action = blockCountries({ countries: ['FR'], mode: 'allow' })

        expect(await action(contextFor(euIpInfo()), request())).toBeUndefined()
        expect((await action(contextFor(), request()))?.status).toBe(451)
    })

    it('fails open on unknown country unless configured otherwise', async () => {
        const info = ipInfo()
        // @ts-expect-error exercising partial API responses
        info.location = undefined

        const failOpen = blockCountries({ countries: ['US'] })
        expect(await failOpen(contextFor(info), request())).toBeUndefined()

        const failClosed = blockCountries({
            countries: ['US'],
            unknown: 'block',
        })
        expect((await failClosed(contextFor(info), request()))?.status).toBe(
            451,
        )
    })

    it('supports custom status and response', async () => {
        const action = blockCountries({
            countries: ['US'],
            status: 403,
        })
        expect((await action(contextFor(), request()))?.status).toBe(403)

        const custom = blockCountries({
            countries: ['US'],
            response: () => Response.json({ blocked: true }, { status: 418 }),
        })
        expect((await custom(contextFor(), request()))?.status).toBe(418)
    })
})

describe('blockThreats', () => {
    it('blocks flagged threats with 403 by default', async () => {
        const info = ipInfo()
        info.security.is_threat = true

        const action = blockThreats()
        expect((await action(contextFor(info), request()))?.status).toBe(403)
    })

    it('lets clean visitors through', async () => {
        const action = blockThreats()
        expect(await action(contextFor(), request())).toBeUndefined()
    })

    it('blocks tor and proxy only when opted in', async () => {
        const info = ipInfo()
        info.security.is_tor = true
        info.security.is_proxy = true

        expect(
            await blockThreats()(contextFor(info), request()),
        ).toBeUndefined()
        expect(
            (
                await blockThreats({ tor: true, proxy: true })(
                    contextFor(info),
                    request(),
                )
            )?.status,
        ).toBe(403)
    })
})

describe('redirectByCountry', () => {
    it('redirects matched countries to a path', async () => {
        const action = redirectByCountry({ redirects: { FR: '/fr' } })
        const response = await action(contextFor(euIpInfo()), request())

        expect(response?.status).toBe(307)
        expect(response?.headers.get('location')).toBe('https://example.com/fr')
    })

    it('redirects to absolute URLs with a custom status', async () => {
        const action = redirectByCountry({
            redirects: { fr: 'https://example.fr' },
            status: 308,
        })
        const response = await action(contextFor(euIpInfo()), request())

        expect(response?.status).toBe(308)
        expect(response?.headers.get('location')).toBe('https://example.fr/')
    })

    it('does not redirect unmatched countries', async () => {
        const action = redirectByCountry({ redirects: { FR: '/fr' } })
        expect(await action(contextFor(), request())).toBeUndefined()
    })

    it('never loops: skips visitors already under the destination', async () => {
        const action = redirectByCountry({ redirects: { FR: '/fr' } })

        expect(
            await action(
                contextFor(euIpInfo()),
                request('https://example.com/fr'),
            ),
        ).toBeUndefined()
        expect(
            await action(
                contextFor(euIpInfo()),
                request('https://example.com/fr/pricing'),
            ),
        ).toBeUndefined()

        // '/france' is a different section and must still redirect
        const response = await action(
            contextFor(euIpInfo()),
            request('https://example.com/france'),
        )
        expect(response?.status).toBe(307)
    })

    it('never loops on same-host absolute destinations', async () => {
        const action = redirectByCountry({
            redirects: { FR: 'https://example.com' },
        })

        expect(await action(contextFor(euIpInfo()), request())).toBeUndefined()
    })

    it('preserves the path and query when configured', async () => {
        const action = redirectByCountry({
            redirects: { FR: '/fr' },
            preservePath: true,
        })
        const response = await action(
            contextFor(euIpInfo()),
            request('https://example.com/pricing?plan=pro'),
        )

        expect(response?.headers.get('location')).toBe(
            'https://example.com/fr/pricing?plan=pro',
        )
    })
})
