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
