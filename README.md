# t27-mcp

An MCP server over the live T27 surfaces. It reads the published `.t27` spec
corpus, the Queen feeds and the numeric-format SSOT, so a question about T27 is
answered from the thing that is actually deployed rather than from a checkout
that may be hundreds of commits behind.

    claude mcp add -s user t27 -- node ~/t27-mcp/server.mjs

A newly registered server is not picked up mid-session; Claude has to restart.

## The rule this server exists to enforce

**No number about T27 is quoted from memory.** The format count, the spec count,
the failing specs and the health split are parsed live on every call. The
numeric-format catalog in particular is read from `// CATALOG:` lines in
`specs/numeric/formats_catalog.t27` at `gHashTag/t27@master`, never from a
constant in this file — a count hardcoded here would be wrong within a week and
would look authoritative while being wrong.

## Tools

| Tool | What it answers |
|---|---|
| `t27_status` | Provenance of the published surface: source commit, spec count, health split with every failing spec named and explained, backend failures, biggest tags |
| `t27_specs` | Search the corpus by path, repo, category, tag, health, failing backend, round-trip loss, type-check errors or size; returns tallies over the matched set |
| `t27_spec` | One spec's whole manifest record and, on request, its actual `.t27` source text |
| `t27_grep` | Regular-expression search *inside* spec sources, over a filtered subset |
| `t27_formats` / `t27_format` | The numeric-format catalog from the live SSOT, and one format's full row |
| `t27_issues` | The cross-repo issue index, with the atlas's issue-to-spec links (relation, coverage, why) |
| `t27_epics` / `t27_modules` / `t27_worlds` | The Queen foundation, module map and covered repositories |
| `t27_game` | The rules of Queen Hive and the live board state |
| `t27_raw` | Read-only escape hatch for any JSON under `t27.ai` |

Every tool takes `fresh: true` to bypass the five-minute cache. That parameter
is not decoration: the publish pipeline is slower than a conversation, so a
cached answer to "is my merge live yet?" is worse than no cache at all.

## Two things worth knowing about the data

**`health: "fail"` hides two unrelated events.** A spec that never parsed
reports `loss: 0`, `tcErrors: 0` and no failed backend — not because it is
clean, but because nothing downstream of the parser ever ran. Its AST counters
(`nodes`, `tokens`, `depth`) are all zero and `outBytes` is empty. A spec that
parsed fine but lost a backend looks superficially similar and is a completely
different problem. `whyFailing` separates them, derived from observable
manifest fields only. As of corpus `93228e640`: 4 backend failures (all
`verilog_hir`) and 2 specs that never parsed.

**The manifest is the rich source; the atlas is the poor one.** The atlas knows
a spec's id and which repositories carry it. The manifest knows whether it
compiles, what it lost, which backends refused it and what it is made of. This
server indexes specs on the manifest. Until v1.1.0 it indexed them on the
atlas, which is why "which specs are failing?" had no answer here at all while
the number 6 sat in `t27_status` with nothing behind it.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `T27_SITE` | `https://t27.ai` | Site to read |
| `T27_REF` | `master` | Git ref for the format SSOT |
| `T27_TTL_MS` | `300000` | Cache lifetime |
| `T27_HEALTH_PORT` | unset | Optional health endpoint shared with `habr-mcp`; imported dynamically, so its absence is not fatal |

## Testing

    npm run smoke

22 checks against the live site, including two that compare independent
readings rather than merely asserting a field exists: the counted backend
failures must equal the specs that blame a backend, and a fetched source file's
byte count must equal the byte count the manifest recorded for it.

## Secrets never enter the repository

No password, API key, token or credentials file is committed, not even in docs or examples. Read secrets from the environment or from a gitignored file.

The gate has three layers, all driven by [`.gitleaks.toml`](.gitleaks.toml):

1. **pre-commit** (lefthook) scans staged changes with gitleaks.
2. **pre-push** (lefthook) scans every commit that is not yet on a remote.
3. **CI** ([`secret-scan`](.github/workflows/secret-scan.yml)) scans the PR range, so `--no-verify` does not get a secret past it.

Set up once per clone: `brew install gitleaks lefthook && lefthook install`.

A secret that was ever pushed is compromised. Removing it from the tree does not unpublish it, so rotate it at the provider.
