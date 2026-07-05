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

import type { IpregistryContext, IpregistrySkipReason } from './types.js'

/**
 * Version prefix of the header payload format. Bump when the encoding
 * changes so that mixed middleware/app versions fail safe (decode to null)
 * instead of misreading each other.
 */
const PAYLOAD_VERSION_PREFIX = '1.'

const SKIP_REASONS: readonly string[] = [
    'static-asset',
    'bot',
    'custom',
    'no-ip',
    'no-middleware',
]

/**
 * Encodes an `IpregistryContext` into a header-safe string: a version prefix
 * followed by the base64url-encoded UTF-8 JSON payload. Headers only carry
 * ISO-8859-1 safely, and lookup data contains arbitrary Unicode (city names,
 * currency symbols), hence the base64url encoding.
 */
export function encodeContext(context: IpregistryContext): string {
    const bytes = new TextEncoder().encode(JSON.stringify(context))

    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i] as number)
    }

    return (
        PAYLOAD_VERSION_PREFIX +
        btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    )
}

/**
 * Decodes a header value produced by `encodeContext`. Returns null for any
 * malformed, truncated, or unknown-version value instead of throwing.
 */
export function decodeContext(value: string): IpregistryContext | null {
    if (!value.startsWith(PAYLOAD_VERSION_PREFIX)) {
        return null
    }

    try {
        const base64 = value
            .slice(PAYLOAD_VERSION_PREFIX.length)
            .replace(/-/g, '+')
            .replace(/_/g, '/')
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)

        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
        }

        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null
        }

        const candidate = parsed as Record<string, unknown>
        const context: IpregistryContext = {
            ip: typeof candidate.ip === 'string' ? candidate.ip : null,
            data:
                candidate.data &&
                typeof candidate.data === 'object' &&
                !Array.isArray(candidate.data)
                    ? (candidate.data as IpregistryContext['data'])
                    : null,
        }

        if (
            typeof candidate.skipped === 'string' &&
            SKIP_REASONS.includes(candidate.skipped)
        ) {
            context.skipped = candidate.skipped as IpregistrySkipReason
        }

        if (
            candidate.error &&
            typeof candidate.error === 'object' &&
            typeof (candidate.error as Record<string, unknown>).message ===
                'string'
        ) {
            const error = candidate.error as Record<string, unknown>
            context.error = {
                message: error.message as string,
                ...(typeof error.code === 'string' ? { code: error.code } : {}),
            }
        }

        return context
    } catch {
        return null
    }
}
