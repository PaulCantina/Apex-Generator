# Apex Impact Calculator

A landing-page calculator that estimates security review time and time saved using **LOC-based** assumptions only.

## What it does

1. Fetches a **public GitHub repository**
2. Counts non-empty LOC by category (in-scope only):
   - Solidity
   - Rust
   - C/C++
   - Other
3. Estimates baseline security review effort and calendar time
4. Estimates an Apex-assisted timeline with a fixed **0.2 week (~1 day) buffer**

## What it does not do

- No vulnerability detection
- No claims about detection/catch rates
- No security quality scoring

## Assumptions

- Solidity: `1000 LOC ≈ 1 reviewer-week`
- Rust + C/C++: `1500 LOC ≈ 1 reviewer-week`
- Other: `2000 LOC ≈ 1 reviewer-week`
- Complexity multiplier starts at `1.0` and is applied to baseline effort:
  - Final estimated weeks = Base weeks × Complexity multiplier
- Complexity penalties/discounts:
  - Assembly/Unsafe penalty: `+0.20` if Solidity `assembly {` or Rust `unsafe {` appears in more than 2 files
  - Upgradability tax: `+0.10` if `delegatecall`, `fallback`, `UUPS`, or `TransparentUpgradeableProxy` is detected
  - OpenZeppelin discount: `-0.15` if `@openzeppelin` is found in dependencies or Solidity imports
- Apex timeline buffer: `0.2 week` (approximately 1 day)
- Manual review reduction modes:
  - Conservative: `20%`
  - Standard: `35%`
  - Strong: `50%`

## Scope filtering (for more realistic estimates)

By default, the calculator excludes common non-audit scope files:

- Tests/specs (`test`, `tests`, `*.test.*`, `*.spec.*`, `*.t.sol`, etc.)
- Interfaces (`interfaces/` directories and Solidity interface-only files)
- Mocks/fixtures/examples/scripts
- Generated/build/vendor directories (`artifacts`, `out`, `build`, `dist`, `generated`, `vendor`, etc.)

The UI also supports:

- **Include paths (optional):** only analyze matching subpaths
- **Exclude paths (optional):** remove matching subpaths from analysis
- **Smart-contract-only mode:** excludes the **Other** language bucket from in-scope LOC

Results show:

- Raw LOC scanned
- Excluded LOC
- Effective LOC used in estimation

## Reviewer team guidance

- Typical team size: **2-4 reviewers** (usually budget dependent)
- If effective in-scope LOC is under **300**, the UI suggests a **solo review** option

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

## Avoid GitHub API rate limits

Unauthenticated GitHub API traffic is limited and large repositories can exceed it quickly.

Use the optional **GitHub token** field in the UI:

1. Generate a new GitHub Personal Access Token (PAT) with minimum required scopes.
2. Paste it into **GitHub token (optional for higher API limits)**.
3. Run estimates normally.

The token is only used in browser requests for the current session.
