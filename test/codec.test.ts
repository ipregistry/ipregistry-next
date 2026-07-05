import { describe, expect, it } from 'vitest'

import { decodeContext, encodeContext } from '../src/codec.js'
import type { IpregistryContext } from '../src/types.js'
import { euIpInfo } from './fixtures.js'

describe('codec', () => {
    it('round-trips a full context', () => {
        const context: IpregistryContext = {
            ip: '2.2.2.2',
            data: euIpInfo(),
        }

        const decoded = decodeContext(encodeContext(context))

        expect(decoded).toEqual(context)
    })

    it('round-trips unicode payloads through the header-safe encoding', () => {
        const context: IpregistryContext = {
            ip: '2.2.2.2',
            data: euIpInfo(),
        }

        const encoded = encodeContext(context)

        // eslint-disable-next-line no-control-regex
        expect(encoded).toMatch(/^1\.[A-Za-z0-9_-]+$/)
        expect(decodeContext(encoded)?.data?.location?.city).toBe('Paris')
    })

    it('round-trips skip reasons and errors', () => {
        const skipped = decodeContext(
            encodeContext({ ip: null, data: null, skipped: 'bot' }),
        )
        expect(skipped?.skipped).toBe('bot')

        const failed = decodeContext(
            encodeContext({
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

    it('returns null for malformed values instead of throwing', () => {
        expect(decodeContext('')).toBeNull()
        expect(decodeContext('garbage')).toBeNull()
        expect(decodeContext('1.!!!not-base64!!!')).toBeNull()
        expect(decodeContext('1.bm90LWpzb24')).toBeNull()
        expect(decodeContext('2.eyJpcCI6bnVsbH0')).toBeNull()
    })

    it('rejects payloads with unexpected shapes', () => {
        const forged = `1.${btoa(JSON.stringify([1, 2, 3]))}`
        expect(decodeContext(forged)).toBeNull()

        const forgedTypes = `1.${btoa(
            JSON.stringify({ ip: 42, data: 'not-an-object', skipped: 'nope' }),
        )}`
        const decoded = decodeContext(forgedTypes)
        expect(decoded).toEqual({ ip: null, data: null })
    })
})
