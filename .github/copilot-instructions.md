# AI Coding Guidelines for Market Watcher

## Architecture Overview
This is a full-stack TypeScript application with a React client and Express server. The client uses Vite for building, shadcn/ui for components, TanStack Query for data fetching, and Wouter for routing. The server provides REST APIs with Drizzle ORM for PostgreSQL data access. Shared schemas are defined in `shared/schema.ts` using Zod and Drizzle.

## Key Directories
- `client/src/`: React application with pages, components, hooks, and lib utilities
- `server/`: Express server with routes, storage interface, and Vite dev setup
- `shared/`: Common schemas and types for client-server communication
- `script/`: Build scripts (e.g., `build.ts` bundles client and server)

## Development Workflows
- **Full-stack dev**: `npm run dev` (runs server with Vite middleware for client)
- **Client-only dev**: `npm run dev:client` (Vite dev server on port 5000)
- **Build**: `npm run build` (custom script using Vite + esbuild)
- **Database**: `npm run db:push` (pushes Drizzle schema to PostgreSQL)
- **Type check**: `npm run check` (runs TypeScript compiler)

## Conventions
- Use `@/` alias for `client/src/` imports in client code
- Use `@shared/` alias for shared imports
- Storage layer uses interface-based design (currently MemStorage, swap for DB impl)
- API routes prefixed with `/api`, logged with timing and response data
- Components follow shadcn/ui patterns with Tailwind CSS
- Data fetching via TanStack Query hooks in components

## Examples
- Add new API route in `server/routes.ts` with `/api` prefix
- Define DB schema in `shared/schema.ts`, generate types with Drizzle
- Create UI component in `client/src/components/ui/` following shadcn structure
- Use `storage` interface in routes for data operations (e.g., `storage.getUser(id)`)

## Integration Points
- PostgreSQL via Drizzle ORM (env: `DATABASE_URL`)
- WebSockets available (ws package imported)
- Authentication via Passport.js (local strategy configured)