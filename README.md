# Apex Impact Calculator

A landing-page calculator that estimates security review time and time saved using **LOC-based** assumptions only.

## What it does

1. Fetches a **public GitHub repository**
2. Counts non-empty LOC by category:
   - Solidity
   - Rust
   - C/C++
   - Other
3. Estimates baseline security review effort and calendar time
4. Estimates an Apex-assisted timeline with results delivered in **1 day**

## What it does not do

- No vulnerability detection
- No claims about detection/catch rates
- No security quality scoring

## Assumptions

- Solidity: `1000 LOC ≈ 1 reviewer-week`
- Rust + C/C++: `1500 LOC ≈ 1 reviewer-week`
- Other: `2000 LOC ≈ 1 reviewer-week`
- Apex delivery: `1 day` (fixed)
- Manual review reduction modes:
  - Conservative: `20%`
  - Standard: `35%`
  - Strong: `50%`

## Run locally

Open `index.html` in your browser.
