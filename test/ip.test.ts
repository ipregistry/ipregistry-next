import { describe, expect, it } from 'vitest'

import {
    anonymizeIp,
    createIpExtractor,
    isPrivateIp,
    isValidIp,
    sanitizeIp,
} from '../src/ip.js'

function requestWithHeaders(headers: Record<string, string>): Request {
    return new Request('https://example.com/', { headers })
}

describe('isValidIp', () => {
    it('accepts valid IPv4 and IPv6 addresses', () => {
        expect(isValidIp('1.2.3.4')).toBe(true)
        expect(isValidIp('255.255.255.255')).toBe(true)
        expect(isValidIp('2001:db8::1')).toBe(true)
        expect(isValidIp('::1')).toBe(true)
        expect(isValidIp('::')).toBe(true)
        expect(isValidIp('2001:0db8:0000:0000:0000:ff00:0042:8329')).toBe(true)
        expect(isValidIp('::ffff:192.168.0.1')).toBe(true)
    })

    it('rejects invalid addresses', () => {
        expect(isValidIp('')).toBe(false)
        expect(isValidIp('example.com')).toBe(false)
        expect(isValidIp('1.2.3')).toBe(false)
        expect(isValidIp('1.2.3.256')).toBe(false)
        expect(isValidIp('1.2.3.4.5')).toBe(false)
        expect(isValidIp('2001:db8:::1')).toBe(false)
        expect(isValidIp('1:2:3:4:5:6:7:8:9')).toBe(false)
        expect(isValidIp('g001:db8::1')).toBe(false)
        expect(isValidIp('<script>')).toBe(false)
    })
})

describe('isPrivateIp', () => {
    it('flags private, loopback, link-local, and CGNAT ranges', () => {
        for (const ip of [
            '0.0.0.0',
            '10.1.2.3',
            '100.64.0.1',
            '127.0.0.1',
            '169.254.1.1',
            '172.16.0.1',
            '172.31.255.255',
            '192.168.1.1',
            '::1',
            '::',
            'fc00::1',
            'fd12:3456::1',
            'fe80::1',
            '::ffff:192.168.0.1',
        ]) {
            expect(isPrivateIp(ip), ip).toBe(true)
        }
    })

    it('does not flag public addresses', () => {
        for (const ip of [
            '8.8.8.8',
            '66.165.2.7',
            '100.128.0.1',
            '172.32.0.1',
            '2001:db8::1',
            '2606:4700::1111',
        ]) {
            expect(isPrivateIp(ip), ip).toBe(false)
        }
    })
})

describe('sanitizeIp', () => {
    it('strips ports, brackets, zones, and whitespace', () => {
        expect(sanitizeIp(' 1.2.3.4 ')).toBe('1.2.3.4')
        expect(sanitizeIp('1.2.3.4:8080')).toBe('1.2.3.4')
        expect(sanitizeIp('[2001:db8::1]')).toBe('2001:db8::1')
        expect(sanitizeIp('[2001:db8::1]:443')).toBe('2001:db8::1')
        expect(sanitizeIp('fe80::1%eth0')).toBe('fe80::1')
    })
})

describe('createIpExtractor', () => {
    it('reads the first x-forwarded-for entry with the default preset', () => {
        const extract = createIpExtractor()
        const request = requestWithHeaders({
            'x-forwarded-for': '66.165.2.7, 10.0.0.1, 172.16.0.1',
        })

        expect(extract(request)).toBe('66.165.2.7')
    })

    it('prefers x-real-ip with the default preset', () => {
        const extract = createIpExtractor('auto')
        const request = requestWithHeaders({
            'x-real-ip': '66.165.2.7',
            'x-forwarded-for': '9.9.9.9',
        })

        expect(extract(request)).toBe('66.165.2.7')
    })

    it('only trusts cf-connecting-ip with the cloudflare preset', () => {
        const extract = createIpExtractor('cloudflare')

        expect(
            extract(
                requestWithHeaders({
                    'cf-connecting-ip': '66.165.2.7',
                    'x-forwarded-for': '9.9.9.9',
                }),
            ),
        ).toBe('66.165.2.7')

        expect(
            extract(requestWithHeaders({ 'x-forwarded-for': '9.9.9.9' })),
        ).toBeNull()
    })

    it('supports a single custom trusted header', () => {
        const extract = createIpExtractor({ header: 'X-Client-IP' })

        expect(
            extract(requestWithHeaders({ 'x-client-ip': '66.165.2.7' })),
        ).toBe('66.165.2.7')
    })

    it('supports a custom extractor function and validates its output', () => {
        const extract = createIpExtractor(() => 'not-an-ip')
        expect(extract(requestWithHeaders({}))).toBeNull()

        const valid = createIpExtractor(() => '66.165.2.7')
        expect(valid(requestWithHeaders({}))).toBe('66.165.2.7')
    })

    it('rejects spoofed garbage in headers', () => {
        const extract = createIpExtractor()

        expect(
            extract(
                requestWithHeaders({
                    'x-forwarded-for': '<script>alert(1)</script>',
                }),
            ),
        ).toBeNull()
    })

    it('returns null when no header is present', () => {
        const extract = createIpExtractor()
        expect(extract(requestWithHeaders({}))).toBeNull()
    })
})

describe('anonymizeIp', () => {
    it('never returns the full address', () => {
        expect(anonymizeIp('66.165.2.7')).toBe('66.165.2.0')
        expect(anonymizeIp('2001:db8:1234:5678::1')).toBe('2001:db8:1234::')
    })
})
