import {
    blockThreats,
    createIpregistryMiddleware,
    redirectByCountry,
} from '@ipregistry/next/middleware'

export const middleware = createIpregistryMiddleware({
    // Reads IPREGISTRY_API_KEY from the environment.
    fields: 'ip,location,security',
    skipBots: true,
    actions: [
        blockThreats({ tor: true, proxy: true }),
        redirectByCountry({
            redirects: { FR: '/fr', DE: '/de' },
            preservePath: true,
        }),
    ],
})

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
