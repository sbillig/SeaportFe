# Compiler integration and fixes

The port is compiled with `toolchain/fe`, branch `seaport-integration`:
Fe `upstream/master` (`342048ea5`, after PR #1618 "Share runtime instances
across call sites" and the compiler performance PRs #1619 and #1621) with
the open pull requests by cburgdorf merged in this order, followed by the
fix commits below.

| PR | Branch | Head |
| --- | --- | --- |
| [#1606](https://github.com/argotorg/fe/pull/1606) | `feat/abi-structs` | `df6b13fe2` |
| [#1523](https://github.com/argotorg/fe/pull/1523) | `fe_fmt_fix` (cburgdorf/fe) | `24d8e35d3` |
| [#1613](https://github.com/argotorg/fe/pull/1613) | `feat/erc1167-clone-helpers` | `95fdd1a7a` |
| [#1604](https://github.com/argotorg/fe/pull/1604) | `feat/std-keccak-helpers` | `c84bd2ef1` |

#1601, #1605, #1614, #1615 and #1616 have been merged upstream in the
meantime. Two merges needed conflict resolutions, both keeping both sides:

- #1613 adds a re-export at the top of `ingots/std/src/evm.fe` next to the
  one #1616 added.
- #1604 and #1605 both add an impl for `SolWordRepr + SolInt` integers in
  `ingots/std/src/abi/sol/ints.fe` (`EncodePacked` and `StorageKey`) and
  extend the same import list.

Fix commits on `seaport-integration`, in order:

| Commit | Fix branch |
| --- | --- |
| `e7db40e98`, `e484e28a3` | `fix/abi-struct-sol-compat` |
| `a9feaff2d` | `fix/temporary-pointer-field-projection` |
| `48d2ccc70`, `ecf734480` | `fix/pointer-loop-reassign-hang` |
| `1532e59a4` | `fix/fixed-bytes-copy` |
| `591f84eb1` | `fix/borrowck-param-overwrite-scaling` |
| `30c384565` | `fix/zero-field-event-emit` |
| `c0247ad51` | `fix/sol-selector-signature-validation` |
| `23100a873` | `fix/tuple-return-abi-params` |
| `6d8f898a8` | `fix/embedded-contract-bytecode-consistency` |
| `71173789d` | uitest snapshot line numbers after the tuple return fix |

`fix/borrowck-entry-instance-sharing` is not part of the current
integration: upstream #1618/#1619/#1621 address the same per-entry
duplication (for code generation as well), conflict with it, and make it
unnecessary (`fe check` on the port: 129 s without it). The earlier
integration on base `06f7889d2` is kept as branch `seaport-integration-v1`;
the "cherry-picked as" hashes below refer to that branch.

Effect of the rebase on the port (runtime bytes, `-O 1`):

| Contract | v1 (`06f7889d2`) | current | Solidity |
| --- | --- | --- | --- |
| `Seaport` | 154,867 | 65,222 | 23,963 |
| `Consideration` | 154,475 | 65,228 | 23,969 |
| `ConduitController` | 9,511 | 7,514 | 7,298 |
| `Conduit` | 5,809 | 3,911 | 2,850 |
| `TransferHelper` | 4,218 | 4,218 | 3,712 |
| `PausableZone` | 8,021 | 7,819 | 6,162 |
| `PausableZoneController` | 15,081 | 14,722 | 12,730 |
| `SeaportRouter` | 10,594 | 10,447 | 6,759 |

`fix/borrowck-param-overwrite-scaling` is still needed on the new base:
`fe check` takes 129 s with it and 374 s without it.

## Fixes made for the port

Each defect found while porting gets its own branch with a regression test
and a newsfragment. Every branch was rechecked against `upstream/master`
`342048ea5` (the regression test fails there) and pushed to
[argotorg/fe](https://github.com/argotorg/fe), rebased onto that commit:

| Branch | Head | Commits on `upstream/master` |
| --- | --- | --- |
| `fix/temporary-pointer-field-projection` | `1188871b4` | 1 |
| `fix/pointer-loop-reassign-hang` | `95773ea98` | 2 |
| `fix/borrowck-param-overwrite-scaling` | `3e4b89ce0` | 3 |
| `fix/fixed-bytes-copy` | `658089143` | 1 |
| `fix/zero-field-event-emit` | `a6c36e7e9` | 1 |
| `fix/sol-selector-signature-validation` | `71c57c456` | 1 |
| `fix/tuple-return-abi-params` | `171f29ad2` | 1 |
| `fix/embedded-contract-bytecode-consistency` | `c1970481a` | 1 |

`fix/borrowck-param-overwrite-scaling` is stacked on
`fix/pointer-loop-reassign-hang`, which it depends on. Its regression test
takes 100 s on `upstream/master`, 105 s with only the pointer-loop fix and
2 s with both. `fix/abi-struct-sol-compat` goes into PR #1606 instead of its own branch.
`fix/borrowck-entry-instance-sharing` is superseded upstream and stays
local. Hashes in the sections below refer to the original branches and the
`seaport-integration-v1` cherry-picks.

### `fix/abi-struct-sol-compat` (ISSUES.md #3)

Base: `feat/abi-structs` (PR #1606), since the fix completes that feature.

- `08c936f66` Implement SolCompat for #[abi] structs: the lowering generates
  `impl SolCompat` with the Solidity tuple type of the fields, built from
  `std::abi::SolPunctuation` literals and each field's `<F as SolCompat>::S`
  and `SOL_TYPE`, chunked for the `AsBytes` tuple arity. Generated
  `SOL_TYPE` consts are checked like hand-written ones (they are only used
  by CTFE), see ISSUES.md #8.
- `90d0da3a4` Accept projections in constant child types of generic impls:
  a value from the generic `DynArray` impl kept an unnormalized projection
  in its type, which failed the CTFE shape check.
- Regression test: `crates/fe/tests/fixtures/fe_test/abi_struct_sol_compat.fe`
  (event topics with struct, nested struct, struct arrays, more than 16
  signature fragments, empty struct; error selector; emission).
- Newsfragment: `newsfragments/+abi-struct-sol-compat.feature.md`.
- `cargo nextest run --release --workspace`: 3661 passed, 1 skipped.
  The expected diagnostics of `ty_check/abi_unsupported_field` gained one
  more "doesn't implement `SolCompat`" error for the invalid field type.

### `fix/temporary-pointer-field-projection` (ISSUES.md #1, part of #2)

Base: `upstream/master` `5a298985b`; cherry-picked into `seaport-integration`.

- `c55b7b1df` Lower field projections through temporary pointers: a field of
  a pointer-valued temporary (`orders.ptr_at(0).n`) had no place, so
  semantic lowering projected the pointer value itself, which
  normalization rejected (error 16-0004), and assignments to it were
  rejected as not assignable. `try_lower_place` now dereferences pointer
  temporaries before selecting the field; assignment checking accepts
  such projections, and a mutably borrowed receiver borrows the pointee.
- Regression test: `crates/fe/tests/fixtures/fe_test/temporary_pointer_field.fe`.
- Newsfragment: `newsfragments/+temporary-pointer-field.bugfix.md`.
- A narrower fix in normalization (reads only) was tried first and dropped
  in favor of this one.

### `fix/pointer-loop-reassign-hang` (ISSUES.md #6, part of #9)

Base: `upstream/master`; cherry-picked into `seaport-integration`.

- `ea612fd02` Widen self-offset pointer provenance in loops: `p = offset(p, k)`
  inside a loop created a new provenance alternative per iteration, so
  `fe check` never reached a fixed point.
- `2b36e5d34` Bound overwritten raw-memory pointers across writes and loops:
  each raw write that might overlap a cell holding a pointer added another
  conditional "overwritten" handle; repeated writes and loop sweeps now reuse
  a bounded set instead of multiplying.
- Regression tests: `crates/fe/tests/fixtures/fe_test/pointer_loop_offset.fe`,
  `crates/fe/tests/fixtures/fe_test/pointer_field_writes_in_loop.fe`.
- Newsfragments: `newsfragments/+pointer-loop-offset-hang.bugfix.md`,
  `newsfragments/+raw-pointer-write-blowup.performance.md`.

### `fix/fixed-bytes-copy` (ISSUES.md #10)

Base: `upstream/master` `342048ea5`; cherry-picked into `seaport-integration`.

- `c384f4b5b` Implement `Copy` for `FixedBytes<N>`: it wraps a single `u256`
  like `Address`, but reading a `Bytes32` field from a view parameter (the
  router forwarding `fulfillerConduitKey`) was a move conflict.
- Regression test: `crates/fe/tests/fixtures/fe_test/fixed_bytes_copy.fe`
  (fails with error 16-0002 without the fix).
- Newsfragment: `newsfragments/+fixed-bytes-copy.bugfix.md`.

### `fix/borrowck-param-overwrite-scaling` (ISSUES.md #9)

Base: `seaport-integration` (depends on `583610595` and `20da6b1b2`);
cherry-picked as `aa4758dd3`.

- `aa77071a8` Bound conditional pointer replacements by object pairs: a
  write that might overlap a pointer cell in a parameter place or local
  (e.g. `book.items.ptr`) added one "maybe overwritten" alternative per
  write site, field, offset and call-site summary choice. One parameter cell
  in `validate_orders_and_prepare_to_fulfill` held about 260 alternatives
  with only about 40 distinct conditions, multiplied per loop sweep.
  Replaced addresses now share the `OpaqueMemory` family of their type and
  keep only their condition, and a raw-memory write against a non-raw target
  is conditioned on the pair of objects instead of every field and offset.
  Trade-off: a caller passing the same raw object for both loses refutation
  by field or offset.
- Regression test: `crates/fe/tests/fixtures/fe_test/pointer_parameter_writes_in_loop.fe`
  (`fe test` 2m08s before, 2.8s after).
- Newsfragment: `newsfragments/+pointer-parameter-overwrite-blowup.performance.md`.
- Effect on the port: `fe check` from about 28 minutes to about 6 minutes.

### `fix/zero-field-event-emit` (ISSUES.md #11)

Base: `upstream/master` `342048ea5`; cherry-picked as `7b1960ac3`.

- `45b536623` Fix MIR lowering of zero-field `#[event]` emits: the desugared
  `emit` body always created a `self` path expression that only field
  accesses use. With no fields it stayed untyped, and the MIR readiness check
  reported it as `InvalidExpr`, blocking the recv arm. `fe check` had
  nothing to report because no diagnostic is emitted for an unused
  expression.
- Regression tests: `crates/fe/tests/fixtures/fe_test/event_zero_fields.fe`,
  `zero_field_event_emits_log1_with_empty_data` in
  `crates/fe/tests/event_dynamic.rs`, desugar snapshot `event_zero_fields`.
- Newsfragment: `newsfragments/+zero-field-event-emit.bugfix.md`.

### `fix/sol-selector-signature-validation` (ISSUES.md #14)

Base: `upstream/master` `342048ea5`; cherry-picked as `5de6c41d6`.

- `584c81e29` Report malformed `sol()` selector signatures at check time: the
  selector/field check returned silently when the signature did not parse.
  It now reports 9-0009 using the parser the JSON ABI emitter uses, which
  also rejects non-identifier names and whitespace.
- Regression test: uitest `ty_check/msg_selector_malformed_signature.fe`.
- Newsfragment: `newsfragments/+sol-selector-signature-validation.bugfix.md`.

### `fix/tuple-return-abi-params` (ISSUES.md #12)

Base: `upstream/master` `342048ea5`; cherry-picked as `9264f7bd7` (IR
snapshots regenerated in `782082291`).

- `1b65ca8b1` Encode dynamic tuple returns as a Solidity parameter list:
  `AbiSize` gains `IS_PARAM_LIST` (true for tuples); `return_value` encodes
  such types without the leading offset word, `decode_output_at` decodes
  them like arguments, and the JSON ABI lists one output per element.
  Semantic change: a Fe contract that relied on a tuple return being one
  `tuple` output must return an `#[abi]` struct instead.
- Regression tests: `crates/fe/tests/fixtures/fe_test/tuple_return_abi_params.fe`,
  `tuple_return_emits_one_output_per_element` in `crates/fe/src/abi.rs`,
  updated harness tests.
- Newsfragment: `newsfragments/+tuple-return-abi-params.bugfix.md`.

### `fix/borrowck-entry-instance-sharing` (ISSUES.md #9), superseded

Base: `seaport-integration` `aa4758dd3` (builds on
`fix/borrowck-param-overwrite-scaling`); cherry-picked as `00b485111`.

- `b4685566e` Share borrow-check instances across entry points: every callee
  reached through an effect carried the identity of the entry point (hidden
  provider type parameter, `UsesParam` site, normalization scope and
  assumptions, recv arm root provider), so a function reachable from N entry
  points was normalized and borrow-checked N times. Identity instances now
  use a placeholder provider per trait, recv arms are rooted at the
  contract, and `share_callee_key` re-roots callee keys that descend from
  these roots. Code-generation keys are unchanged, so emitted code is
  identical.
- Regression tests: two unit tests in `borrowck/check.rs` (entry functions
  with differently ordered `uses` lists share the callee; two recv arms
  share it while codegen roots stay separate).
- Newsfragment: `newsfragments/+borrowck-entry-instance-sharing.performance.md`.
- Effect on the port: `fe check` from about 396 s to 153 s, `fe build -O 1`
  from about 386 s to 161 s (measured without other load).

### `fix/embedded-contract-bytecode-consistency` (ISSUES.md #15)

Base: `upstream/master` `342048ea5`; cherry-picked as `f23bd6955`.

- `7e6a7ce4d` Embed created contracts as their standalone bytecode: all
  objects of a module were lowered into one Sonatina module and optimized
  together, so a child embedded by `create2<Child>` was compiled with the
  parent's functions (symbol renaming changed the layout, shared helpers
  changed inlining, and the parent used up the module-wide inlining budget).
  Each root object is now compiled in its own module; embedded objects are
  compiled first and placed as constant data, so `Contract::init_code_*`
  point at exactly the child's artifact. A contract's bytecode also no
  longer depends on the other contracts in the same file.
- Not yet moved over: `fe trace`, `--emit ir` and contracts created in
  `fe test` still use the single-module compile.
- Regression test: `crates/fe/tests/embedded_contract_bytecode.rs` with the
  ingot `crates/fe/tests/fixtures/embedded_contract_bytecode/` (checks
  containment and that the deployed address equals CREATE2 over
  `keccak(Child.bin)`).
- Newsfragment: `newsfragments/+embedded-contract-bytecode-consistency.bugfix.md`.
