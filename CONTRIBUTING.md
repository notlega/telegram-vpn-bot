# Contributing

thanks for looking at the project. it is a small codebase, keep changes focused.

## setup

```sh
bun install
cp .env.example .env
bunx wrangler login
```

requires [bun](https://bun.sh) 1.2+ and node 22+ for tooling. wrangler is a
project devDependency, `bun install` pins it.

## checks

all checks are manual. there is no ci workflow, so run them yourself before
pushing.

`bun run check` runs the typecheck and biome, `bun run lint` runs biome alone,
`bun run format` rewrites formatting.

```sh
bun run check
bun run lint
bun run format
```

a change that touches the worker should also pass a bundle check:

```sh
bunx wrangler deploy --dry-run
```

## code style

biome owns formatting and linting. beyond that:

- lowercase sentence starts in comments, log strings and doc summaries. keep
  formal names, product names and identifiers as-is (`Telegram`, `Vultr`,
  `BOT_TOKEN`)
- no trailing period in doc summaries, log strings, table cells and commit
  subjects
- no one-line block statements. `if (done) return;` is wrong, use braces on
  their own lines
- blank line between logical steps, before a block that opens after a statement,
  and after a block closes. no blank right after an opening `{`
- one blank line between interface properties and between class methods
- every exported function, type and interface gets jsdoc, including each
  interface property

## commits

conventional commits, lowercase subject, no co-authored-by trailer:

```
feat: add /probe command
fix: log swallowed telegram errors
docs: describe env file setup
build: add biome
refactor: move helper scripts to typescript
style: normalize block spacing
chore: add license
```

one logical change per commit. do not mix unrelated edits.

## docs and wiki

`docs/` is the source of truth. the github wiki mirrors these pages; when a page
changes, copy it over so the wiki stays in sync. wiki page names are capitalised
(`Home`, `Architecture`, `Deployment`, `Clients`, `Operations`), the repo files
are lowercase.

## security

never commit `.env`, bot tokens, vultr api tokens or generated `vless://` links.
the bot stores credentials in workers kv only. see the security notes in the
readme.
