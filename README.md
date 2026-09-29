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

The port is built with Fe `upstream/master` plus all open pull requests by
cburgdorf, merged into the local branch `seaport-integration` of
`toolchain/fe`. Compiler defects found during the port are fixed on separate
branches; see [COMPILER_FIXES.md](COMPILER_FIXES.md). All problems
encountered, including language and library gaps, are logged in
[ISSUES.md](ISSUES.md).

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

Results with the current build (`seaport-integration` at the head recorded
in `reference_manifest.json`, `fe build -O 1`):

| Suite | Solidity (pinned reference) | Fe |
| --- | --- | --- |
| Foundry, `upstream_suite.py` | 482 passed | 482 passed |
| Hardhat, `hardhat_suite.py` | 402 passing, 1 pending | 402 passing, 1 pending |
| Foundry, `upstream_suite.py --both` | 482 passed | 480 passed |

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

- Code size: the Fe `Seaport` runtime is about 65 KB (154 KB before the
  rebase onto upstream PR #1618), still well above the 24 KB EIP-170 limit
  that the Solidity build just meets (ISSUES.md #13). `Seaport` and
  `Consideration` deploy only with the size limit lifted; both test scripts
  do that. The periphery contracts are within 1.0 to 1.6 times their
  Solidity size and below the limit. Sizes per contract are in
  [COMPILER_FIXES.md](COMPILER_FIXES.md).
- Gas: Fe code uses more gas than the hand-optimized assembly of
  seaport-core. Tests that pin gas budgets pass, but absolute costs are
  higher. The same calls in the same Foundry test (`test_fuzzCoverage_x`):

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

`bootstrap.py` clones the pinned Seaport revision, builds its Foundry and
Hardhat artifacts, clones Fe at the pinned base and applies
`compiler/seaport-integration.patch` (the full difference of the
`seaport-integration` branch, checked against `reference_manifest.json`),
then builds the compiler and the Fe contracts into `build/fe`. Required
tools: git, Rust, Node with yarn, Foundry.
