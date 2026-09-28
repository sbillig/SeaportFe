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
