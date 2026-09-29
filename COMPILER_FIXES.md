# Compiler integration and fixes

The port is compiled with `toolchain/fe`, branch `seaport-integration`:
Fe `upstream/master` (`06f7889d2`) with all open pull requests by cburgdorf
merged in this order.

| PR | Branch | Head |
| --- | --- | --- |
| [#1616](https://github.com/argotorg/fe/pull/1616) | `feat/address-checksum-and-integer-sqrt` | `f1a46198b` |
| [#1615](https://github.com/argotorg/fe/pull/1615) | `feat/dynamic-text-concat` | `64bbee73a` |
| [#1614](https://github.com/argotorg/fe/pull/1614) | `feat/minimum-gas-calls` | `bb3863621` |
| [#1606](https://github.com/argotorg/fe/pull/1606) | `feat/abi-structs` | `df6b13fe2` |
| [#1605](https://github.com/argotorg/fe/pull/1605) | `feat/std-sol-storage` | `2904b5e5b` |
| [#1601](https://github.com/argotorg/fe/pull/1601) | `feat/std-call-helpers` | `08aa4443b` |
| [#1523](https://github.com/argotorg/fe/pull/1523) | `fe_fmt_fix` (cburgdorf/fe) | `24d8e35d3` |
| [#1613](https://github.com/argotorg/fe/pull/1613) | `feat/erc1167-clone-helpers` | `95fdd1a7a` |
| [#1604](https://github.com/argotorg/fe/pull/1604) | `feat/std-keccak-helpers` | `c84bd2ef1` |

Two merges needed conflict resolutions, both keeping both sides:

- #1613 and #1616 both add re-exports at the top of `ingots/std/src/evm.fe`.
- #1604 and #1605 both add an impl for `SolWordRepr + SolInt` integers in
  `ingots/std/src/abi/sol/ints.fe` (`EncodePacked` and `StorageKey`) and
  extend the same import list.

## Fixes made for the port

Each defect found while porting gets its own branch in `toolchain/fe` with a
regression test and a newsfragment. The branches are local (not pushed).

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
