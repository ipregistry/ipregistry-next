import { getIpregistry } from '@ipregistry/next'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
    const { data, error } = await getIpregistry(request)

    if (!data) {
        // Fail-open: the middleware attached no data (lookup skipped or
        // failed); serve a degraded response instead of an error page.
        return NextResponse.json({ country: null, degraded: Boolean(error) })
    }

    return NextResponse.json({
        country: data.location?.country?.code ?? null,
        region: data.location?.region?.name ?? null,
        city: data.location?.city ?? null,
        timeZone: data.time_zone?.id ?? null,
    })
}
