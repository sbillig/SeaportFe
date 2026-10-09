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

This branch targets Fe's mutable value semantics (MVS) branch at
`169ed8ce360a69bb92cdb20bba5a78b41280c6c4`. Its committed Sonatina revision
`601010bc9364276e598143ebb5749f8273832df6` currently prevents a clean compiler
build: Fe imports `EvmKeccak256Words`, which that dependency lacks. The
compiler pin must be fixed before the draft bootstrap can build successfully.
No compiler patches or dependency overrides are applied by the bootstrap.

The source migration builds all eight contracts and passes all twelve Fe tests
with the existing local MVS toolchain, which uses Sonatina
`361e0e86a88413f12e0ef1cb16b7ef75bbb10034` through local path dependencies.
The current MVS build passes all 482 Foundry tests (1,000 cases per fuzz
test) and all 402 Hardhat tests, with the upstream one pending test. All eight
contract ABIs are identical to the initial MVS migration.

The source baseline is SeaportFe `6ffc19564ecc3121bfbf0cc7752b9c7a81cb7eea`,
which passes `fe check` and builds all eight contracts on Fe master
`26e1fddd269c020ed41f77aa8777d2dc83c1c252`.
It includes direct component hashing, constant bulk-order typehashes, and
immutable environment passing. Later local calldata and output-buffer
changes are deferred: their `#[decode(manual)]` dispatch feature is absent
from both that master revision and MVS.

Book, Resolvers, and Groups own non-Copy MemArray pools. Order descriptors
retain immutable Bytes signatures and extra data, and helpers use scoped MVS
views or explicit mutable parameters. Generated orders replace the item pool
in place. DynVec builds nested ABI arrays; exact protocol encoders use a
checked, initialized owning byte buffer. Copyable raw pool and byte handles
have been removed. Explicit unsafe blocks fell from 333 to 72: three implement
the checked byte boundary, and the rest access the fixed Solidity storage
layout.
`COMPILER_FIXES.md` and `compiler/seaport-integration.patch` describe the
historical toolchain; neither is used to build this branch.

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

Current MVS verification uses Fe 169ed8ce3 / Sonatina 361e0e86 at `-O1`.
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
controller, Fe lists the errors a contract can raise (plus `Panic`), and Fe
marks `PausableZone.supportsInterface` as `pure`, not `view`. The basic
order entry points and the conduit batch functions use numeric selectors
(their calldata is read raw), so they have no ABI entry.

## Limitations

- Typed ABI dispatch retains the baseline's strict decoding. Malformed
  calldata can be rejected earlier than the optimized Solidity implementation,
  which sometimes reads raw words with zero padding. The deferred manual
  decoder changes address those differences.
- Code size: this MVS build has a 49,809-byte Seaport runtime and a
  49,815-byte Consideration runtime, above the 24 KB EIP-170 limit
  (ISSUES.md #13). Both test scripts lift the size limit. The eight-contract
  build uses Fe 169ed8ce3 / local Sonatina 361e0e86 at `-O1`; periphery
  runtimes are 4,181 to 13,071 bytes. The checked encoder conversion increased
  Consideration from 47,418 bytes for the initial owned-pool phase to 49,815
  bytes; these checks and initialization have a code-size cost.
- Gas: Fe code uses more gas than the hand-optimized assembly of
  seaport-core. The current upstream behavioral suites, including gas-budget
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

  Most of the difference is fixed cost per call: ABI decoding into the
  in-memory order model and memory management, where seaport-core works on
  calldata pointers directly.
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
Hardhat artifacts, then builds the pinned Fe MVS compiler and contracts into
`build/fe`. An existing `toolchain/fe` must be at the exact pinned revision
with no tracked changes. Required tools: git, Rust, Node with npm, Foundry.
Yarn 1.22.22 is invoked through npx for the reference's frozen lockfile.
