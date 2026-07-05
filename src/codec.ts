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
 * Version prefixes of the header payload format. '1.' is plain base64url
 * UTF-8 JSON; '2.' is base64url deflate-compressed UTF-8 JSON. Unknown
 * prefixes decode to null so that mixed middleware/app versions fail safe
 * instead of misreading each other.
 */
const PLAIN_PREFIX = '1.'
const DEFLATE_PREFIX = '2.'

/**
 * Payloads at or below this JSON size (bytes) are not worth compressing:
 * deflate overhead and CPU cost exceed the savings, and skip/error contexts
 * are tiny anyway.
 */
const COMPRESSION_THRESHOLD = 512

const SKIP_REASONS: readonly string[] = [
    'static-asset',
    'bot',
    'custom',
    'no-ip',
    'no-middleware',
]

/**
 * Encodes an `IpregistryContext` into a header-safe string: a version prefix
 * followed by the base64url-encoded UTF-8 JSON payload, deflate-compressed
 * when large enough to matter. Headers only carry ISO-8859-1 safely, and
 * lookup data contains arbitrary Unicode (city names, currency symbols),
 * hence the base64url encoding; compression keeps full payloads well under
 * proxy request-header limits.
 */
export async function encodeContext(
    context: IpregistryContext,
): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(context))

    if (
        bytes.length > COMPRESSION_THRESHOLD &&
        typeof CompressionStream === 'function'
    ) {
        try {
            const deflated = await transform(
                bytes,
                new CompressionStream('deflate'),
            )
            return DEFLATE_PREFIX + toBase64Url(deflated)
        } catch {
            // Fall through to the uncompressed format.
        }
    }

    return PLAIN_PREFIX + toBase64Url(bytes)
}

/**
 * Decodes a header value produced by `encodeContext`. Returns null for any
 * malformed, truncated, or unknown-version value instead of throwing.
 */
export async function decodeContext(
    value: string,
): Promise<IpregistryContext | null> {
    try {
        let bytes: Uint8Array

        if (value.startsWith(DEFLATE_PREFIX)) {
            bytes = await transform(
                fromBase64Url(value.slice(DEFLATE_PREFIX.length)),
                new DecompressionStream('deflate'),
            )
        } else if (value.startsWith(PLAIN_PREFIX)) {
            bytes = fromBase64Url(value.slice(PLAIN_PREFIX.length))
        } else {
            return null
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

async function transform(
    bytes: Uint8Array,
    stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
    const readable = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
    return new Uint8Array(await new Response(readable).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i] as number)
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }

    return bytes
}
