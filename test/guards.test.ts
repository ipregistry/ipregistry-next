import { describe, expect, it } from 'vitest'

import { isBot, isEuVisitor, isThreat } from '../src/guards.js'
import type { IpregistryContext } from '../src/types.js'
import { euIpInfo, ipInfo } from './fixtures.js'

describe('isEuVisitor', () => {
    it('detects EU visitors from IpInfo', () => {
        expect(isEuVisitor(euIpInfo())).toBe(true)
        expect(isEuVisitor(ipInfo())).toBe(false)
    })

    it('accepts the context returned by getIpregistry', () => {
        const context: IpregistryContext = { ip: '2.2.2.2', data: euIpInfo() }
        expect(isEuVisitor(context)).toBe(true)
    })

    it('fails open on missing data, unless assumeEu is set', () => {
        expect(isEuVisitor(null)).toBe(false)
        expect(isEuVisitor(undefined)).toBe(false)
        expect(isEuVisitor({ ip: null, data: null })).toBe(false)
        expect(isEuVisitor(null, { assumeEu: true })).toBe(true)
        expect(isEuVisitor({ ip: null, data: null }, { assumeEu: true })).toBe(
            true,
        )
        // Explicit data always wins over assumeEu.
        expect(isEuVisitor(ipInfo(), { assumeEu: true })).toBe(false)
    })
})

describe('isThreat', () => {
    it('flags threat, attacker, and abuser by default', () => {
        expect(isThreat(ipInfo())).toBe(false)

        for (const key of ['is_threat', 'is_attacker', 'is_abuser'] as const) {
            const info = ipInfo()
            info.security[key] = true
            expect(isThreat(info), key).toBe(true)
        }
    })

    it('does not flag proxy, Tor, or VPN unless opted in', () => {
        const info = ipInfo()
        info.security.is_proxy = true
        info.security.is_tor = true
        info.security.is_vpn = true

        expect(isThreat(info)).toBe(false)
        expect(isThreat(info, { proxy: true })).toBe(true)
        expect(isThreat(info, { tor: true })).toBe(true)
        expect(isThreat(info, { vpn: true })).toBe(true)
    })

    it('covers tor exit nodes with the tor option', () => {
        const info = ipInfo()
        info.security.is_tor_exit = true

        expect(isThreat(info, { tor: true })).toBe(true)
    })

    it('allows disabling default signals', () => {
        const info = ipInfo()
        info.security.is_abuser = true

        expect(isThreat(info, { abuser: false })).toBe(false)
    })

    it('fails open on missing data', () => {
        expect(isThreat(null)).toBe(false)
        expect(isThreat({ ip: null, data: null })).toBe(false)
    })
})

describe('isBot', () => {
    const googlebot =
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    const chrome =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

    it('detects bots from a user agent string', () => {
        expect(isBot(googlebot)).toBe(true)
        expect(isBot(chrome)).toBe(false)
    })

    it('detects bots from request-like objects', () => {
        const request = new Request('https://example.com/', {
            headers: { 'user-agent': googlebot },
        })
        expect(isBot(request)).toBe(true)

        const nodeStyle = { headers: { 'user-agent': googlebot } }
        expect(isBot(nodeStyle)).toBe(true)
    })

    it('returns false when no user agent is available', () => {
        expect(isBot(null)).toBe(false)
        expect(isBot(undefined)).toBe(false)
        expect(isBot(new Request('https://example.com/'))).toBe(false)
        expect(isBot({ headers: {} })).toBe(false)
    })
})
