import { createIpregistryMiddleware } from '@ipregistry/next/middleware'

export const middleware = createIpregistryMiddleware({
    fields: 'ip,location',
})

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
