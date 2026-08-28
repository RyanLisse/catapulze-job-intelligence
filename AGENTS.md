# Catapulze Job Intelligence

Bun monorepo for Catapulze Job Intelligence. Workspace packages use the `@ji` scope (Job Intelligence).

| Path                   | Role                                      |
| ---------------------- | ----------------------------------------- |
| `apps/web`             | Next.js UI on port 3001                   |
| `apps/server`          | Hono + tRPC API on port 3000              |
| `packages/api`         | tRPC router and procedures                |
| `packages/application` | Use-case layer (bronregister, Slice A)    |
| `packages/auth`        | Better Auth                               |
| `packages/connectors`  | Connector contract and source adapters    |
| `packages/db`          | Drizzle schema and Neon client            |
| `packages/domain`      | Domain types and Boolean parser (Slice A) |
| `packages/env`         | Typed env for server and web              |
| `packages/ui`          | Shared UI components                      |
| `packages/config`      | Shared TypeScript config                  |

Do not query Postgres from the web app. Reads and writes go through `apps/server` / `packages/api`. Secrets stay in `apps/server/.env` and `apps/web/.env` (see `.env.example` files); never commit them.

The parent directory name `clients:catapulze` contains a colon, which splits Unix `PATH` when an absolute `node_modules/.bin` path is prepended. Package scripts prepend the **relative** `./node_modules/.bin` entry so binaries resolve. Do not switch those scripts back to bare `tsc` / `turbo` / `ultracite` without that prefix.

Linting uses Ultracite (Oxlint + Oxfmt) plus a vendored [anti-slop](https://github.com/dmmulroy/anti-slop) plugin at `tools/oxlint/anti-slop/`. Treat that copy as owned project tooling: change the rules here rather than depending on a published package. Effect-specific anti-slop rules stay off until `effect` is a direct dependency.

Do not import `@ji/db`, `drizzle-orm`, or `packages/infra` from `apps/web`. Run `bun run check-layering` after changing web imports. Run `bun test` (max 2 workers, no watch) and `bun run check-secrets` before finishing a change. Secrets stay out of git; `.env.example` lists names and placeholders only.

Slice A plans and docs may reference `packages/infra`; this repo uses `@ji/db` for Postgres/Drizzle instead.

---

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Oxlint + Oxfmt (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Oxlint + Oxfmt Can't Help

Oxlint + Oxfmt's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Oxlint + Oxfmt can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Oxlint + Oxfmt. Run `bun x ultracite fix` before committing to ensure compliance.

## Learned User Preferences

- Do not commit accidental `docs/` formatter churn from pre-commit; restore or leave unstaged when committing code-only changes.
- Commit OpenWiki updates separately from feature work (pre-commit wiki guard).

## Learned Workspace Facts

- Quality verbs: `bun run fix` / `check` (changed vs `origin/main`), `gate` (full pre-push), `wiki` (OpenWiki local). `fix:all` / `check:all` are deliberate whole-tree escape hatches.
- Lefthook owns pre-commit (scoped `ultracite fix {staged_files}`) and pre-push (`gate`). Never run `qlty githooks install`.
- Qlty (`.qlty/qlty.toml`) covers shell/workflows/secrets; Ultracite + anti-slop owns TS/JS. All `qlty check` uses `--no-formatters`; never `qlty fmt`.
- Live app verification skill: `.cursor/skills/verify-job-intelligence/` (web 3001, API 3000).

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a committed `openwiki/` evidence index (see `openwiki/INSTRUCTIONS.md`). It is optional just-in-time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Agent completion: run `bun run fix` once after edits, not per-file ultracite.
- Do not mix `openwiki/` changes into feature commits. Scheduled CI opens PRs on branch `openwiki/update`.

<!-- OPENWIKI:END -->
