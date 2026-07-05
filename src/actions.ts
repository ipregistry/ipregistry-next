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

import { NextResponse, type NextRequest } from 'next/server.js'

import { isThreat, type ThreatOptions } from './guards.js'
import type { IpregistryLookupContext } from './types.js'

/**
 * A middleware decision hook. Actions run in order after a successful
 * lookup; the first action that returns a `Response` short-circuits the
 * request (block, redirect, rewrite...). Return undefined or null to let the
 * request continue. Actions never run when the lookup was skipped or failed:
 * with the default fail-open behavior such requests pass through untouched.
 */
export type IpregistryAction = (
    context: IpregistryLookupContext,
    request: NextRequest,
) => Response | null | undefined | Promise<Response | null | undefined>

export interface BlockCountriesOptions {
    /**
     * ISO 3166-1 alpha-2 country codes (e.g. 'FR', 'US'), case-insensitive.
     */
    countries: string[]

    /**
     * 'block' (default) denies the listed countries; 'allow' denies every
     * country except the listed ones.
     */
    mode?: 'block' | 'allow'

    /**
     * What to do when the country is unknown (no `location.country.code` in
     * the response). Defaults to 'allow' (fail-open).
     */
    unknown?: 'allow' | 'block'

    /**
     * The HTTP status of the blocking response. Defaults to 451 (Unavailable
     * For Legal Reasons).
     */
    status?: number

    /**
     * A custom response factory replacing the default plain-text response.
     */
    response?: (
        context: IpregistryLookupContext,
        request: NextRequest,
    ) => Response
}

/**
 * Creates an action that blocks (or exclusively allows) visitors by country,
 * based on `location.country.code`. Requires the lookup to include the
 * `location` fields.
 */
export function blockCountries(
    options: BlockCountriesOptions,
): IpregistryAction {
    const countries = new Set(
        options.countries.map((code) => code.toUpperCase()),
    )
    const mode = options.mode ?? 'block'
    const status = options.status ?? 451

    return (context, request) => {
        const code = context.data.location?.country?.code?.toUpperCase()

        let blocked: boolean

        if (!code) {
            blocked = options.unknown === 'block'
        } else {
            blocked =
                mode === 'block' ? countries.has(code) : !countries.has(code)
        }

        if (!blocked) {
            return undefined
        }

        if (options.response) {
            return options.response(context, request)
        }

        return new NextResponse('Access restricted in your region.', {
            status,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
    }
}

export interface BlockThreatsOptions extends ThreatOptions {
    /**
     * The HTTP status of the blocking response. Defaults to 403.
     */
    status?: number

    /**
     * A custom response factory replacing the default plain-text response.
     */
    response?: (
        context: IpregistryLookupContext,
        request: NextRequest,
    ) => Response
}

/**
 * Creates an action that blocks visitors whose IP is flagged by Ipregistry
 * security data. By default blocks `is_threat`, `is_attacker`, and
 * `is_abuser`; enable `proxy`, `tor`, `vpn`, `relay`... to also block
 * anonymized traffic. Requires the lookup to include the `security` fields.
 */
export function blockThreats(
    options: BlockThreatsOptions = {},
): IpregistryAction {
    const status = options.status ?? 403

    return (context, request) => {
        if (!isThreat(context.data, options)) {
            return undefined
        }

        if (options.response) {
            return options.response(context, request)
        }

        return new NextResponse('Access denied.', {
            status,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
    }
}

export interface RedirectByCountryOptions {
    /**
     * Maps upper- or lower-case ISO 3166-1 alpha-2 country codes to a
     * destination: either a path ('/fr') resolved against the current origin
     * or an absolute URL ('https://example.de').
     */
    redirects: Record<string, string>

    /**
     * The redirect status. Defaults to 307 (temporary) so browsers do not
     * cache a geo decision; use 308 for permanent country domains.
     */
    status?: 307 | 308

    /**
     * Whether to append the current path and query to the destination, e.g.
     * FR + '/fr' turns '/pricing' into '/fr/pricing'. Defaults to false.
     */
    preservePath?: boolean
}

/**
 * Creates an action that redirects visitors to a country-specific path or
 * domain based on `location.country.code`. Never redirects when the visitor
 * is already under the destination (loop-safe). Requires the lookup to
 * include the `location` fields.
 */
export function redirectByCountry(
    options: RedirectByCountryOptions,
): IpregistryAction {
    const redirects = new Map(
        Object.entries(options.redirects).map(([code, destination]) => [
            code.toUpperCase(),
            destination,
        ]),
    )
    const status = options.status ?? 307

    return (context, request) => {
        const code = context.data.location?.country?.code?.toUpperCase()
        const destination = code ? redirects.get(code) : undefined

        if (!destination) {
            return undefined
        }

        const current = new URL(request.url)
        const target = destination.startsWith('/')
            ? new URL(destination, current.origin)
            : new URL(destination)

        const targetPath = target.pathname.replace(/\/$/, '')

        const alreadyThere =
            target.host === current.host &&
            (targetPath === '' ||
                current.pathname === targetPath ||
                current.pathname.startsWith(`${targetPath}/`))

        if (alreadyThere) {
            return undefined
        }

        if (options.preservePath) {
            target.pathname = `${targetPath}${current.pathname}`.replace(
                /\/{2,}/g,
                '/',
            )
            target.search = current.search
        }

        return NextResponse.redirect(target, status)
    }
}
