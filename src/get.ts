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

import { decodeContext } from './codec.js'
import { IPREGISTRY_HEADER, type IpregistryContext } from './types.js'

/**
 * The places `getIpregistry` can read the Ipregistry context from: a fetch
 * `Request`/`NextRequest`, anything exposing request headers (including
 * Node's `IncomingMessage`, so `getServerSideProps` context `req` works), or
 * a `Headers` instance.
 */
export type IpregistrySource =
    | Request
    | Headers
    | {
          headers: Headers | Record<string, string | string[] | undefined>
      }

const NO_MIDDLEWARE: IpregistryContext = {
    ip: null,
    data: null,
    skipped: 'no-middleware',
}

/**
 * Reads the Ipregistry context attached to the current request by the
 * middleware. Never throws and never triggers an API call.
 *
 * In server components, layouts, and server actions, call it without
 * arguments (it reads `next/headers`):
 *
 * ```ts
 * const { data } = await getIpregistry()
 * ```
 *
 * In route handlers and in the Pages Router, pass the request:
 *
 * ```ts
 * export async function GET(request: NextRequest) {
 *     const { data } = await getIpregistry(request)
 * }
 * ```
 *
 * When the middleware did not run for the request, the returned context has
 * `data: null` and `skipped: 'no-middleware'`.
 */
export async function getIpregistry(
    source?: IpregistrySource,
): Promise<IpregistryContext> {
    let value: string | null = null

    if (source) {
        value = readHeader(source, IPREGISTRY_HEADER)
    } else {
        // Imported lazily so that bundling this module for the Pages Router
        // or route handlers does not pull in App-Router-only machinery.
        const { headers } = await import('next/headers.js')
        value = (await headers()).get(IPREGISTRY_HEADER)
    }

    if (!value) {
        return { ...NO_MIDDLEWARE }
    }

    return decodeContext(value) ?? { ...NO_MIDDLEWARE }
}

function readHeader(source: IpregistrySource, name: string): string | null {
    const headers = source instanceof Headers ? source : source.headers

    if (typeof (headers as Headers).get === 'function') {
        return (headers as Headers).get(name)
    }

    const record = headers as Record<string, string | string[] | undefined>
    const value = record[name] ?? record[name.toLowerCase()]

    if (Array.isArray(value)) {
        return value[0] ?? null
    }

    return typeof value === 'string' ? value : null
}
