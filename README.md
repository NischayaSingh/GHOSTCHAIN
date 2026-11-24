# GHOSTCHAIN

GHOSTCHAIN is a browser-only coded-storage simulator. It demonstrates Reed–Solomon recovery, KZG data availability sampling, adaptive replication, and commit–reveal storage audits.

## Run the project

Use Node 22.12 or newer.

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
npm run experiment -- --verify
```

Deploy `dist/` as a static site. `vercel.json` provides the Vercel build and output settings. The deployed UI needs no backend, RPC endpoint, wallet, or account. Browser cryptography requires HTTPS or localhost.

## Custom input and AI

Open **Network → Controls → Use my data or AI**. Paste text or pick a file up to 6 MiB minus a 4-byte length prefix. The browser pads the source, constructs both axes of parity, commits each row, and generates openings on demand during sampling. Sampling traffic uses the 6 MiB padded block as the denominator. The first session on a custom block can take a minute. Demo blocks use pre-generated proofs.

For either AI action, set one server key: `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `GROQ_API_KEY`. Select it with `GHOSTCHAIN_AI_PROVIDER=gemini|openai|groq`; when unset, the server chooses the first configured key in that order (Gemini, Groq, OpenAI). Run `npm run dev -- --host 127.0.0.1` (or `npm run preview -- --host 127.0.0.1` after building). The local server keeps keys off the browser. Optional models: `GHOSTCHAIN_GEMINI_MODEL` (default `gemini-2.5-flash`), `GHOSTCHAIN_AI_MODEL` (OpenAI default `gpt-4.1-mini`), and `GHOSTCHAIN_GROQ_MODEL` (default `llama-3.3-70b-versatile`). The static hosted build supports custom recovery and sampling; AI actions require the local server.

**Explain with AI** sends only numeric and boolean metrics. **Generate with AI** sends the prompt and feeds the generated text into local encoding.

## Explore the demo

1. In Network, set **Fault injection** to 0% and produce a block. Check the 6 MiB block, 128×128 square, and byte-exact recovery.
2. Open **Light client** and wait for WASM to initialize. Run a 16-cell session and then **Test tampered cell**. Try 30 samples for the plan's high-confidence setting.
3. Return to Network and increase fault injection to 50%. Move quadrant withholding to 100%, increase latency to 280 ms, and watch the controller raise replication. Compare the adaptive and static finality indicators.
4. Run an audit and expand a slashed event. Open **Benchmarks** and switch between experiment profiles or download CSV and JSON.

## Architecture

| Path | Responsibility |
| --- | --- |
| `packages/core/src/erasure.ts` | Systematic Cauchy Reed–Solomon over GF(256), extended across both dimensions |
| `packages/core/src/commit.ts` | Row commitment wire format and verification adapter |
| `packages/core/src/das.ts` | Sampling, confidence, and byte accounting |
| `packages/core/src/sim.ts` | Seeded placement, node behavior, deadlines, and repair simulation |
| `packages/core/src/redundancy.ts` | Feedback controller with hysteresis |
| `packages/core/src/audit.ts` | Assignment challenges, commitment checks, and ledger changes |
| `apps/web/src/` | React/Recharts UI, network Worker, and independent WASM verifier Worker |
| `scripts/` | Fixture producer, benchmark configuration, and reproducible sweep |

The network Worker encodes the source bytes, places the shards, and decodes available shards with the actual product code. The browser verifier receives the row commitments and sampled openings through Worker messages. The payload is 4,096 source cells of 1,536 bytes. The systematic square contains 16,384 cells. Each 128-cell row uses two SHA-256-derived field values per EIP-7594 data cell and one 48-byte row commitment. The adjacent digest is enough to rebuild the native KZG verification cell.

The demo cycles through three prepared blocks. `npm run fixtures` regenerates the fixture books from their public seeds using the native crate-crypto producer and the Ethereum KZG setup. Generation is quicker in the native producer. Runtime encoding, distribution, audits, and verification are browser-local. The released static assets include the prepared proof books. Sampling traffic counts simulated protocol bytes from a client viewpoint. The static bundle and producer fixture load are application setup traffic.

## Experiments

`npm run experiment` regenerates the seeded 10–60% sweep exports in `apps/web/public/results/`. It uses structural repair masks for throughput. The dashboard checks decoded bytes for live adaptive rounds. Adaptive, static 2× and static 4× use the same network conditions and nested deterministic placements. Four prior observations warm up the adaptive estimate per trial. Deadline-capped finality substitutes the 300 ms deadline for failed trials. Verification time comes from Chromium and is reported separately from the seeded simulation.

At 60% seeded random node faults with full first-quadrant withholding, 280 ms added latency and a 300 ms deadline, adaptive and static 4× each recovered 100 of 100 blocks. Static 2× recovered 32. Mean per-node storage was 15.21%, 16.00% and 8.00% respectively. At 10% faults in that profile, adaptive finality averaged 216 ms versus 209 ms for static 2×. These are scoped simulator results. KZG checks bind sampled cells to the committed header. The light client does not prove that an untrusted producer constructed valid parity.

One RS line can recover from any 64 of 128 cells. A 2D block depends on the geometry of available cells. A contiguous 65×65 missing square is a stopping set for this decoder. At f = 25%, the detection approximation gives 99.9821% from 30 verified samples. One full 30-cell session uses 54,752 bytes, or 0.8703% of one source block. Two full rounds at 16 each cost 0.9218%. The UI caps two-round sessions at 17 cells per round to keep the modeled exchange below 1%.

## Browser rehearsal and stretch proof

Use `npx playwright install chromium`, then run `npm run build && npm run rehearse`. The script runs twice through the dashboard and serves the build to an isolated offscreen Chromium test context. It writes screenshots and raw timing JSON to `reports/rehearsal/`. Set `GHOSTCHAIN_CHROMIUM` to use a system Chromium, or `GHOSTCHAIN_REHEARSAL_URL` to test a reachable deployed build. To record the second pass, install Playwright FFmpeg and add `-- --record`.

`npm run zk:verify` verifies the bundled Groth16 proof. `npm run zk:build` regenerates the Circom circuit, local demo setup and proof. The public signals are the Poseidon root and position. The witness contains a digest and its authentication path. This independent eight-cell tree is derived from the example block and has a separate commitment from the KZG header.

## References

- [Celestia rsmt2d](https://github.com/celestiaorg/rsmt2d), Apache-2.0. Adopted product-code row and column extension and deletion/repair validation. This repository uses an independently written TypeScript implementation.
- [Codex DAS Research](https://github.com/codex-storage/das-research), Apache-2.0. Adopted configurable seeded trials and progress metrics. This simulator models custody and timeouts through a smaller abstraction.
- [ethereumjs/kzg-wasm](https://github.com/ethereumjs/kzg-wasm), MIT per the npm package manifest. Used its documented PeerDAS batch verifier and default trusted setup.
- [crate-crypto rust-eth-kzg](https://github.com/crate-crypto/rust-eth-kzg), MIT or Apache-2.0. Its Node API generates compatible commitments and proofs for the reproducible fixtures.
- [DAS simulation study](https://arxiv.org/abs/2407.18085) and [DAS over Kademlia](https://arxiv.org/abs/2402.09993). Informed separation of adversarial nodes, response delay, recovery and validation metrics.

- [Circom](https://github.com/iden3/circom), [circomlib](https://github.com/iden3/circomlib) and [snarkjs](https://github.com/iden3/snarkjs). The stretch uses the library Poseidon circuit and standard Groth16 tooling.
