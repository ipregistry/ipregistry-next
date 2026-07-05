# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-05

### Added

- `createIpregistryMiddleware` to enrich matched requests with Ipregistry
  data, attached as the `x-ipregistry` request header, with configuration via
  environment variables (`IPREGISTRY_API_KEY`, `IPREGISTRY_BASE_URL`,
  `IPREGISTRY_TIMEOUT`, `IPREGISTRY_FIELDS`) or an explicit config object.
- `getIpregistry` to read the request context from server components, route
  handlers, server actions, and `getServerSideProps`.
- Built-in middleware actions: `blockCountries`, `blockThreats`, and
  `redirectByCountry` (loop-safe, with optional path preservation).
- Guards: `isEuVisitor` (GDPR/EU detection via `location.in_eu`), `isThreat`
  (via `security.is_*`), and `isBot` (SDK user-agent heuristic).
- Trusted-proxy IP extraction presets (`auto`, `cloudflare`, `vercel`,
  `nginx`, `forwarded-for`), single-header and custom extractor support, with
  strict IP validation and private/reserved range filtering.
- Built-in lookup caching through the official SDK's `InMemoryCache`, with
  support for custom `IpregistryCache` implementations.
- Static asset skipping (default on), optional bot skipping, and custom skip
  predicates to avoid wasting credits.
- Fail-open error handling by default with optional fail-closed mode,
  `onError` hook, and anonymized-IP debug logging.
- Spoofing protection: incoming `x-ipregistry` headers are always stripped.
