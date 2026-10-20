# Seaport 1.6 in Fe

A port of [Seaport 1.6](https://github.com/ProjectOpenSea/seaport) (the
`seaport-core` implementation) and its periphery contracts to
[Fe](https://github.com/argotorg/fe).

## Contracts

| Fe contract | Solidity original |
| --- | --- |
| `Seaport`, `Consideration` (`src/seaport.fe`) | `contracts/Seaport.sol`, `seaport-core/src/lib/Consideration.sol` |
| `Conduit` (`src/conduit.fe`) | `seaport-core/src/conduit/Conduit.sol` |
| `ConduitController` (`src/conduit_controller.fe`) | `seaport-core/src/conduit/ConduitController.sol` |
| `TransferHelper` (`src/transfer_helper.fe`) | `contracts/helpers/TransferHelper.sol` |
| `SeaportRouter` (`src/router.fe`) | `contracts/helpers/SeaportRouter.sol` |
| `PausableZone`, `PausableZoneController` (`src/pausable_zone.fe`) | `contracts/zones/` |

`Seaport` and `Consideration` share all code and differ only in their name,
which is part of the EIP-712 domain. Seaport's own tests deploy
`Consideration`.

The library code follows the `seaport-core` structure:

| Module | seaport-core |
| --- | --- |
| `abi_view.fe` | argument checks and calldata reads of ConsiderationDecoder |
| `model.fe` | decoded orders as a mutable in-memory model (ConsiderationDecoder) |
| `hashing.fe` | ConsiderationBase, GettersAndDerivers |
| `status.fe` | CounterManager, OrderValidator storage, ReentrancyGuard |
| `signature.fe` | Verifiers (bulk orders), SignatureVerification |
| `amount.fe` | AmountDeriver |
| `criteria.fe` | CriteriaResolution |
| `executor.fe` | Executor, TokenTransferrer, the conduit accumulator |
| `zone.fe` | ZoneInteraction, contract orders, ConsiderationEncoder |
| `applier.fe` | FulfillmentApplier |
| `fulfill.fe` | OrderValidator._validateOrder, OrderFulfiller |
| `combiner.fe` | OrderCombiner |
| `basic.fe` | BasicOrderFulfiller |
| `manage.fe` | cancel, validate |

Observable behavior follows the optimized `seaport-core` code, including its
error precedence, revert data, event data, calldata sent to zones, contract
offerers, conduits and tokens, and the storage layout (Seaport's tests read
and write order status slots directly).

## Compiler

This branch builds with the size-optimized Fe branch
[`sbillig/fe` `opt/seaport-size-20261019`](https://github.com/sbillig/fe/tree/opt/seaport-size-20261019)
at `d37393273`, which is Fe master `822e80878` plus the compiler changes listed
under [Size and gas](#size-and-gas). Its Cargo dependencies pin Sonatina from
[`sbillig/sonatina` `opt/seaport-size-20261019`](https://github.com/sbillig/sonatina/tree/opt/seaport-size-20261019)
at `b85ad012`. `scripts/bootstrap.py` builds that exact compiler with
`cargo build --locked --release -p fe` and the contracts at `-Os`, the level
recorded in `reference_manifest.json`.

The source baseline is SeaportFe `6ffc19564ecc3121bfbf0cc7752b9c7a81cb7eea`,
which passes `fe check` and builds all eight contracts on Fe master
`26e1fddd269c020ed41f77aa8777d2dc83c1c252`.
It includes direct component hashing, constant bulk-order typehashes, and
immutable environment passing. Later local calldata and output-buffer
changes are deferred: their `#[decode(manual)]` dispatch feature is absent
from both that master revision and MVS.

Mutable owned locals use `var`; `mut` continues to grant write access to
parameters and places, and `ref` keeps a read access. Book, Resolvers, and
Groups own non-Copy MemArray pools. Order descriptors retain immutable Bytes
signatures and extra data, and helpers use scoped MVS views or explicit mutable
parameters. Generated orders replace the item pool
in place. DynVec builds nested ABI arrays; exact protocol encoders use a
checked, initialized owning byte buffer. Copyable raw pool and byte handles
have been removed. Explicit unsafe blocks fell from 333 to six: three inside
the checked byte boundary in `buffer.fe`, and three order-pool allocations in
`model.fe`. Every order record, including its immutable Bytes handles, is
fully initialized before the pool is read or returned; these records cannot
be constructed by zeroing bytes. Storage uses declared owners:
`OrderStore` at slot 0 contains the counter, status and nonce mappings;
conduits use a rooted map and `SolEnumerableSet` for their channel registry;
zones retain their exact packed words. Persistent and transient guard fields
share the protocol's numeric slot in their respective address spaces. The
guard takes short accesses before and after external calls, and its constructor
probe uses an initialized word array. No application raw storage operations or
copyable raw owner handles remain.
`COMPILER_FIXES.md` and `compiler/seaport-integration.patch` describe the
historical toolchain; neither is used to build this branch.

<!-- size-gas:begin -->
## Size and gas

Runtime bytes and receipt gas, with the compiler above at `-Os`. Before:
the same contracts migrated to Fe master `822e80878` at `-O1`. solc: the
pinned Seaport's optimized artifacts. Receipt gas comes from
`tests/rooted-storage.cjs` in transient guard mode, on identical calls.

| Contract | Before | Now | solc |
| --- | ---: | ---: | ---: |
| Seaport | 54,156 | 24,002 | 23,963 |
| Consideration | 54,162 | 24,008 | 23,969 |
| Conduit | 3,970 | 2,681 | 2,850 |
| ConduitController | 7,589 | 5,347 | 7,298 |
| TransferHelper | 4,796 | 3,646 | 3,712 |
| SeaportRouter | 11,151 | 5,055 | 6,759 |
| PausableZone | 7,411 | 5,630 | 6,162 |
| PausableZoneController | 14,099 | 11,845 | 12,730 |
| Total | 157,334 | 82,214 | 87,443 |

| Call | Before | Now | solc |
| --- | ---: | ---: | ---: |
| Advanced ERC721/native self fulfillment | 128,191 | 116,237 | 113,085 |
| Validate one order | 57,334 | 41,701 | 40,064 |
| Cancel one order | 40,521 | 33,647 | 33,272 |
| Increment counter | 29,255 | 27,967 | 27,976 |
| getOrderStatus (cold) | 25,160 | 23,818 | 23,669 |
| name (cold) | 22,527 | 21,642 | 21,240 |
| getCounter (cold) | 24,076 | 24,055 | 24,109 |
| Create conduit | 908,150 | 649,195 | 676,738 |
| Create zone | 1,554,667 | 1,196,831 | 1,297,167 |
| Open a channel | 120,746 | 120,258 | 120,891 |
| Transfer conduit ownership | 49,879 | 49,818 | 50,233 |

Every contract except Seaport/Consideration is now at or below the solc size,
and Seaport/Consideration fit under the 24,576-byte EIP-170 limit.

Compiler changes (Fe and Sonatina branches above):
- Messages and custom errors encode into one buffer. `revert_error` stays out
  of line and writes static errors to scratch memory. Static return values of
  up to 0x80 bytes go to scratch memory too, the way Solidity returns small
  values.
- The free pointer is set once at the section entry, so heap allocations need
  no per-site clamp. Word mapping keys and `keccak_words` preimages hash from
  frame scratch without allocating. Small local buffers that are used once per
  call and never escape live in the frame instead of the heap. The size
  pipeline also inlines more.

Contract changes:
- The fulfillment, match, validate, cancel and getOrderHash arms read their
  arguments straight from calldata through `CalldataView` (`src/abi_view.fe`),
  with seaport-core's checks. Order hashes come from raw calldata words.
- Outputs, events and errors are encoded directly into their final buffers
  (`src/raw_abi.fe`).
- SeaportRouter reads its parameters from calldata with solc's checks;
  `tests/router-diff.cjs` compares it with the solc router.
- Settlement, aggregation and transfers are merged into shared paths, and
  arithmetic is unchecked wherever seaport-core's is.

The behavior differences for malformed input are listed under Limitations.
<!-- size-gas:end -->

## Tests

Seaport's own test suites run against the Fe bytecode:

- `scripts/upstream_suite.py` runs the Foundry suite (`test/foundry`, 482
  tests, including the fuzz engine in `test/foundry/new`). The suite deploys
  its "optimized" contracts from precompiled artifacts; the script injects
  the Fe `Consideration`, `ConduitController` and `TransferHelper` there.
  `--both` also replaces the reference implementation.
- `scripts/hardhat_suite.py` runs the Hardhat suite (`test/*.spec.ts`) with
  the Fe bytecode in the Hardhat artifacts of all ported contracts.
- `scripts/compare_abi.py` compares the Fe JSON ABIs with the Solidity
  artifacts (functions with outputs and mutability, events, errors).

`tests/rooted-storage.cjs` additionally compares exact map/record/array slots,
packed status and zone updates, channel swap/removal and ownership events,
and both guard modes against the pinned Solidity artifacts. It records receipt
gas for identical calls, including cold getters sent as transactions. The
fallback case changes only test initcode's feature-probe payload to INVALID;
production bytecode is unchanged. This exercises fallback
on the compiler's supported Cancun target instead of trying to deploy Cancun
instructions on an older fork. It then changes the deployed test probe to STOP
to exercise activation. After compiling the reference artifacts and building
Fe contracts into `build/fe`, run:

```sh
cd reference/seaport
./node_modules/.bin/hardhat run --no-compile --config ../../tests/hardhat.config.ts ../../tests/rooted-storage.cjs
```

Set `SEAPORT_VARIANTS` to a JSON array of `[label, Fe build directory]` pairs
(use `null` for pinned Solidity) to compare multiple Fe builds. Set
`SEAPORT_REPORT` to save the gas results as JSON. Each variant and guard mode
starts from a fresh chain. Set `SEAPORT_TRACE_HASHES=1` to count the exact
`keccak256(conduit, 0)` map preimages and assert log/write ordering for
transfer, cancellation and acceptance. The test compares full event bytes
and checks that each event precedes its corresponding storage write.

Fe master 735827147 builds all eight production contracts at `-O1`, passes all
14 Fe tests, all 482 Foundry tests (1,000 cases per fuzz test), and the full
Hardhat suite (402 passing, one pending). Its 24 output files are
byte-identical to those of the fix branch commit b428098ab, on which the
behavioral suites ran. The ABIs differ from the previous Fe master
33ee9be28 build only in no longer listing the implicit `Panic(uint256)` error.
The rooted-storage differential passes against pinned Solidity and the
33ee9be28 artifacts in both transient and forced persistent guard modes,
including exact storage slots, event bytes, map hashes, and log/write ordering.

The build retains the two documented `--both` Foundry differences:
480 pass and `testRevertErc20Transfer` / `testMatchAuthRevertAndInvMagicValue`
fail when the optimized port also replaces Solidity's reference behavior.

Focused receipt measurements against the 33ee9be28 build are shown below.
Both the source (addresses, string literals) and the compiler changed, so
these are combined build deltas. Both guard modes have the same deltas, and
intrinsic calldata gas is equal in each comparison. The other measured calls
change by at most 14 gas.

| Call | 33ee9be28 build | Current build |
| --- | ---: | ---: |
| Cancel one order | 40,999 | 40,962 |
| Validate one order | 58,462 | 58,340 |
| Advanced ERC721/native self fulfillment | 130,254 | 128,818 |
| Name getter | 22,836 | 22,693 |
| Create conduit | 1,004,310 | 954,081 |
| Create zone | 1,607,485 | 1,607,463 |

Historical October 11 verification used Fe 093ff36d5 / Sonatina 11722eac at `-O1`.
All eight production contracts build and their ABIs are unchanged from the
initial MVS port. The full upstream results match the documented pre-MVS
results:

| Suite | Observed result |
| --- | --- |
| Fe tests | 12 passed |
| Foundry, optimized artifacts replaced | 482 passed; 1,000 cases per fuzz test |
| Hardhat, all eight contracts replaced | 402 passing, 1 pending |
| Foundry, optimized and reference artifacts replaced | 480 passed, 2 documented expected failures |

The two `--both` failures are expected: `testRevertErc20Transfer` and
`testMatchAuthRevertAndInvMagicValue` assert behavior that differs on
purpose between the reference and the optimized implementation, and the
port follows the optimized one.

The ABIs match except for listings: Solidity lists every error of the
inherited interfaces and the shared events of `PausableZone` and its
controller, Fe lists the errors a contract can raise, and Fe
marks `PausableZone.supportsInterface` as `pure`, not `view`. The order
entry points (fulfill, match, validate, cancel, `getOrderHash`) and the
conduit batch functions use numeric selectors (their calldata is read raw),
so they have no ABI entry. `SeaportMsg` keeps the typed forms for callers.
`OrderValidated` is written with a raw log operation, and custom errors with
static fields revert through the shared encoders of `raw_abi.fe`; the Fe
ABI walk only sees typed emits and `revert_error` calls, so it lists neither.

## Limitations

- Order arguments are read from calldata as seaport-core reads them: the
  Solidity dispatcher's head checks, then 32-bit masked offsets and lengths,
  zero-padded reads, raw words in order hashes, and enum checks
  (`Panic(0x21)`) where Seaport reads an enum from memory. Signatures, extra
  data, criteria resolvers and fulfillment components are read in place
  rather than copied. Two differences remain for malformed calldata. The
  model holds addresses truncated, as Solidity's typed reads see them, so
  zones and contract offerers receive truncated item and offerer words where
  seaport-core copies the raw words. And Seaport copies those in-place values
  before use, so absurd 32-bit lengths that exhaust its gas while copying
  only fail here if the value is read.
- SeaportRouter validates `fulfillAvailableAdvancedOrders` parameters from
  calldata with solc's checks, in solc's order, and decodes Seaport's
  `(bool[], Execution[])` returndata strictly. One difference remains: for a
  bytes or array length below 2^64 that exceeds what solc's free-memory
  pointer can still address, solc reverts with `Panic(0x41)` and Fe reverts
  without data. `tests/router-diff.cjs` finds no other difference.
- PausableZone's `authorizeOrder` and `validateOrder` check only the
  `ZoneParameters` offset and 320-byte head, as Solidity does for a calldata
  struct it never reads, instead of decoding the whole struct.
- A Fe `Address` holds no bits above the low 160. Raw words become addresses
  either after the check Solidity performs (basic orders, conduit transfers)
  or by truncation, like Solidity's masked storage reads. The conduit batch
  path reports the raw token word in its errors, as seaport-core does. One
  difference remains: a contract offerer whose `generateOrder` returndata has
  high bits in an extra offer item's token or in a recipient the original
  order leaves open gets the truncated address. seaport-core keeps the raw
  word. Returned items that have an original are still compared word for word.
- Code size: with the compiler above at `-Os`, the Seaport and Consideration
  runtimes are 24,002 and 24,008 bytes, under the 24 KB EIP-170 limit
  (ISSUES.md #13); see [Size and gas](#size-and-gas). Earlier builds:
  Fe master 735827147 / committed Sonatina 6bef907f at `-O1`
  produced a 57,339-byte Seaport runtime and a 57,345-byte Consideration
  runtime, above the limit. Both upstream
  harnesses lift the size limit. Periphery runtimes range from 4,200 to
  14,554 bytes. Fe master 33ee9be28 / Sonatina cdb34cbb produced
  58,266/58,272-byte Seaport/Consideration runtimes, and periphery runtimes of
  4,450 to 14,538 bytes. The historical Fe 093ff36d5 / Sonatina 11722eac build
  produced 57,600/57,606-byte Seaport/Consideration runtimes. The prior raw-storage/rooted-owner comparison on Fe d6c0f863e
  produced 57,412/57,681-byte Seaport and 57,418/57,687-byte Consideration
  runtimes. The earlier compiler-update growth from 49,815 bytes on Fe
  169ed8ce3 to 57,418 on c329ceff3 remains unexplained; it is separate from
  this storage refactor.
- Gas: Fe code uses more gas than the hand-optimized assembly of
  seaport-core. The October 11 upstream behavioral suites, including gas-budget
  cases, pass. The following pre-MVS measurements are historical; these calls
  came from one Foundry test (`test_fuzzCoverage_x`):

  | Call | Solidity | Fe |
  | --- | --- | --- |
  | `getCounter` (cold) | 2,677 | 6,295 |
  | `getOrderStatus` (cold) | 2,465 | 6,203 |
  | `getOrderHash` (1 consideration item) | 1,736 | 14,576 |
  | `fulfillAdvancedOrder`, native consideration | 21,653 | 46,551 |

  Sharing helper instances instead of specializing them per entry point
  (upstream #1618) cost about 5 to 8% gas on these calls in exchange for
  the smaller code.

  Most of the difference is fixed cost per call: copying orders into the
  in-memory model and memory management.

  The prior rooted-storage differential benchmark compared the raw source at
  d176b8c and rooted owners at efd2b89, both built with d6c0f863e / Sonatina
  361e0e86.
  Transaction receipt gas includes the same calldata and intrinsic costs:

  | Call | Raw storage | Rooted owners | Change |
  | --- | ---: | ---: | ---: |
  | Validate one order | 56,217 | 55,893 | -324 |
  | Fulfill one advanced ERC721/native order | 128,666 | 128,857 | +191 |
  | Open a channel | 120,442 | 120,635 | +193 |
  | Cancel one order | 38,773 | 38,859 | +86 |
  | Increment counter | 28,110 | 28,116 | +6 |

  These are focused cases, not an overall gas claim. Cancel and validate use
  empty item arrays; fulfillment uses one ERC721 and one native consideration
  item. In each case the caller is the offerer, skipping signature checks.
  Scoped entries avoid
  repeated map lookup work within a phase. Further gains need the std map's
  fixed-word keys to use the existing value-level word hash; its current
  encoder allocates a preimage for each lookup.
  Fe 420a3bd52 fixes the generic `Ctx`/`Log` conflict. Ownership helpers now
  keep one mutable entry across caller reads, logs and writes in Solidity's
  order. Accesses still close before external calls. Both efd2b89 and
  78c170e were rebuilt with that compiler and Sonatina 361e0e86:

  | Ownership call | efd2b89 gas | 78c170e gas | Map hashes, before → after |
  | --- | ---: | ---: | ---: |
  | Transfer | 49,956 | 49,882 | 2 → 1 |
  | Cancel transfer | 27,701 | 27,635 | 2 → 1 |
  | Accept | 32,438 | 32,315 | 3 → 1 |

  The hash counts come from exact 64-byte controller map preimages in EVM
  traces. The same savings hold in both guard modes. Channel open/remove save
  6/5 gas; the other measured calls are unchanged. ConduitController shrinks
  from 8,522 to 8,467 runtime bytes. Comparing efd2b89 under d6c0f863e and
  420a3bd52 shows unchanged receipt gas in these cases and a separate seven
  byte reduction in Seaport and Consideration. No operand-order rejections
  occurred in either source version. Historical evidence is recorded in
  `build/sealed-capabilities-420/validation.json`.

  The historical locked Fe 093ff36d5 / Sonatina 11722eac build leaves contract
  source unchanged from 78c170e. Re-running its previous artifacts reproduces
  every prior receipt exactly. The update changes focused receipt gas:

  | Call | Previous build | Current build | Change |
  | --- | ---: | ---: | ---: |
  | Cancel one order | 38,859 | 39,221 | +362 |
  | Validate one order | 55,893 | 56,274 | +381 |
  | Advanced ERC721/native self fulfillment | 128,857 | 129,529 | +672 |
  | Name getter | 22,446 | 22,834 | +388 |
  | Create conduit | 1,077,606 | 1,026,126 | -51,480 |
  | Create zone | 1,468,559 | 1,447,815 | -20,744 |

  The same deltas hold in both guard modes. Getters are sent as cold
  transactions; the name case was added and measured on both old and new
  artifacts in this run. Counter, empty order-status, conduit-owner and zone
  getters are cheaper by 13 to 75 gas. The harness records intrinsic calldata
  gas separately; it is equal across these comparisons. Ownership map hashes
  remain one per call. These larger increases are reported without source
  workarounds. Sonatina #392 fixes recovered-pointer liveness, but this
  Seaport comparison does not attribute each cost to #392 alone: the update
  also includes #398–#402 and rebased PR 397. Evidence, all receipt deltas and
  runtime sizes are in `build/committed-sonatina-093/validation.json`.
- Explicit ABI view annotation would let `getOrderHash` match Solidity without
  retaining a read-only context grant purely for ABI classification.
- The SeaportValidator and SeaportNavigator helpers (off-chain view
  contracts in `contracts/helpers/`) are not ported; the Foundry tests that
  use them deploy the Solidity versions.

## Setup

```
scripts/bootstrap.py              # reference checkout, compiler, Fe build
scripts/upstream_suite.py
scripts/hardhat_suite.py
```

`bootstrap.py` clones the pinned Seaport revision and builds its Foundry and
Hardhat artifacts, then builds the pinned Fe master compiler and contracts into
`build/fe`. An existing `toolchain/fe` must be at the exact pinned revision
with no tracked changes. Required tools: git, Rust, Node with npm, Foundry.
Yarn 1.22.22 is invoked through npx for the reference's frozen lockfile.
