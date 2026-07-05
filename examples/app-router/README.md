# App Router example

Minimal App Router setup showing the Ipregistry middleware, a server
component reading geolocation data, and a route handler.

Files:

- `middleware.ts`: enriches requests, blocks Tor/proxy threats, redirects
  French and German visitors to localized sections.
- `app/page.tsx`: personalizes content and shows a consent banner to EU
  visitors only.
- `app/api/geo/route.ts`: exposes a degraded-tolerant geo endpoint.

To run it inside a real app: copy these files into a Next.js project, then

```sh
npm install @ipregistry/next
echo 'IPREGISTRY_API_KEY=YOUR_API_KEY' >> .env.local
npm run dev
```

On localhost your IP is private so no lookup happens; add
`developmentIp: '66.165.2.7'` to the middleware config to simulate a real
visitor while developing.
