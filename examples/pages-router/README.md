# Pages Router example

The same middleware works unchanged with the Pages Router; read the data in
`getServerSideProps` by passing `req` to `getIpregistry`.

Files:

- `middleware.ts`: enriches requests with location data.
- `pages/index.tsx`: reads the data in `getServerSideProps`.

Setup inside a real app:

```sh
npm install @ipregistry/next
echo 'IPREGISTRY_API_KEY=YOUR_API_KEY' >> .env.local
npm run dev
```
