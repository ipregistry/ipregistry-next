import { describe, expect, it } from 'vitest'

import { decodeContext, encodeContext } from '../src/codec.js'
import type { IpregistryContext } from '../src/types.js'
import { euIpInfo } from './fixtures.js'

function plainEncode(value: unknown): string {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return `1.${btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')}`
}

describe('codec', () => {
    it('round-trips a full context', async () => {
        const context: IpregistryContext = {
            ip: '2.2.2.2',
            data: euIpInfo(),
        }

        const decoded = await decodeContext(await encodeContext(context))

        expect(decoded).toEqual(context)
    })

    it('round-trips unicode payloads through the header-safe encoding', async () => {
        const context: IpregistryContext = {
            ip: '2.2.2.2',
            data: euIpInfo(),
        }

        const encoded = await encodeContext(context)

        expect(encoded).toMatch(/^[12]\.[A-Za-z0-9_-]+$/)
        expect((await decodeContext(encoded))?.data?.location?.city).toBe(
            'Paris',
        )
    })

    it('compresses large payloads and keeps small ones plain', async () => {
        const small: IpregistryContext = {
            ip: null,
            data: null,
            skipped: 'bot',
        }
        expect(await encodeContext(small)).toMatch(/^1\./)

        const large: IpregistryContext = { ip: '2.2.2.2', data: euIpInfo() }
        // @ts-expect-error oversized synthetic payload
        large.data.padding = 'padding '.repeat(512)

        const encoded = await encodeContext(large)
        expect(encoded).toMatch(/^2\./)
        expect(encoded.length).toBeLessThan(plainEncode(large).length)
        expect(await decodeContext(encoded)).toEqual(large)
    })

    it('still decodes the uncompressed legacy format', async () => {
        const context: IpregistryContext = { ip: '2.2.2.2', data: euIpInfo() }

        expect(await decodeContext(plainEncode(context))).toEqual(context)
    })

    it('round-trips skip reasons and errors', async () => {
        const skipped = await decodeContext(
            await encodeContext({ ip: null, data: null, skipped: 'bot' }),
        )
        expect(skipped?.skipped).toBe('bot')

        const failed = await decodeContext(
            await encodeContext({
                ip: '2.2.2.2',
                data: null,
                error: { code: 'INVALID_API_KEY', message: 'nope' },
            }),
        )
        expect(failed?.error).toEqual({
            code: 'INVALID_API_KEY',
            message: 'nope',
        })
    })

    it('returns null for malformed values instead of throwing', async () => {
        expect(await decodeContext('')).toBeNull()
        expect(await decodeContext('garbage')).toBeNull()
        expect(await decodeContext('1.!!!not-base64!!!')).toBeNull()
        expect(await decodeContext('1.bm90LWpzb24')).toBeNull()
        expect(await decodeContext('2.bm90LWRlZmxhdGU')).toBeNull()
        expect(await decodeContext('9.eyJpcCI6bnVsbH0')).toBeNull()
    })

    it('rejects payloads with unexpected shapes', async () => {
        const forged = plainEncode([1, 2, 3])
        expect(await decodeContext(forged)).toBeNull()

        const forgedTypes = plainEncode({
            ip: 42,
            data: 'not-an-object',
            skipped: 'nope',
        })
        const decoded = await decodeContext(forgedTypes)
        expect(decoded).toEqual({ ip: null, data: null })
    })
})
