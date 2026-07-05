import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { encodeContext } from '../src/codec.js'
import { getIpregistry } from '../src/get.js'
import { IPREGISTRY_HEADER, type IpregistryContext } from '../src/types.js'
import { euIpInfo } from './fixtures.js'

const context: IpregistryContext = { ip: '2.2.2.2', data: euIpInfo() }
const encoded = encodeContext(context)

describe('getIpregistry', () => {
    it('reads the context from a NextRequest (route handlers)', async () => {
        const request = new NextRequest('https://example.com/api/geo', {
            headers: { [IPREGISTRY_HEADER]: encoded },
        })

        expect(await getIpregistry(request)).toEqual(context)
    })

    it('reads the context from a fetch Request', async () => {
        const request = new Request('https://example.com/', {
            headers: { [IPREGISTRY_HEADER]: encoded },
        })

        expect(await getIpregistry(request)).toEqual(context)
    })

    it('reads the context from a Headers instance', async () => {
        const headers = new Headers({ [IPREGISTRY_HEADER]: encoded })
        expect(await getIpregistry(headers)).toEqual(context)
    })

    it('reads the context from Node-style headers (Pages Router)', async () => {
        const req = { headers: { [IPREGISTRY_HEADER]: encoded } }
        expect(await getIpregistry(req)).toEqual(context)

        const multiValue = { headers: { [IPREGISTRY_HEADER]: [encoded] } }
        expect(await getIpregistry(multiValue)).toEqual(context)
    })

    it('reports no-middleware when the header is absent', async () => {
        const result = await getIpregistry(new Request('https://example.com/'))

        expect(result.data).toBeNull()
        expect(result.skipped).toBe('no-middleware')
    })

    it('never throws on malformed header values', async () => {
        const request = new Request('https://example.com/', {
            headers: { [IPREGISTRY_HEADER]: 'not-a-valid-payload' },
        })

        const result = await getIpregistry(request)
        expect(result.data).toBeNull()
        expect(result.skipped).toBe('no-middleware')
    })
})
