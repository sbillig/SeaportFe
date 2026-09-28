# Problems encountered while porting Seaport to Fe

Compiler: `toolchain/fe`, branch `seaport-integration` (upstream/master
`06f7889d2` plus all open cburgdorf PRs, see `COMPILER_FIXES.md`).

Each entry records the symptom, a minimal reproduction, the workaround used in
the port and, for compiler defects, the fix branch.

## 1. Internal borrowck error on field access through a temporary pointer

Status: compiler bug, fixed on branch `fix/temporary-pointer-field-projection`
(see COMPILER_FIXES.md), which also makes writes through a temporary
pointer (`f().field = x`, `f().field += x`) assignable.

```fe
use core::ptr::MemArray
struct Item { a: u256, b: u256 }
struct Order { items: MemArray<Item>, n: u256 }
#[test]
fn nested_ptr() {
    let mut orders = MemArray<Order>::new_uninit(1)
    let mut items = MemArray<Item>::new_uninit(1)
    items[0] = Item { a: 1, b: 2 }
    orders[0] = Order { items, n: 5 }
    assert(orders.ptr_at(0).n == 5)   // error[16-0004]
}
```

`error[16-0004]: internal borrow checking error ... normalized body contains an
invalid projection`. Any field projection whose base is a pointer-valued
temporary (`f().field`, `p.items.ptr_at(0).a`) triggers it. Binding the pointer
to a local first (`let o = orders.ptr_at(0); o.n`) works.

Workaround: always bind `ptr_at(..)` results to locals.

## 2. Assignment to a field of an indexed element is rejected

Status: language limitation (open). Writes through temporary pointers are
covered by the fix for #1; `IndexMut` element fields (`arr[i].field = x`)
are still rejected.

`arr[i].field = x` (with `arr: MemArray<S>`, which implements `IndexMut`)
fails with `error[8-0017]: not assignable left-hand side of assignment`, even
with `let mut arr`. Whole-element assignment `arr[i] = s` and `arr[i] += d`
work. Workaround: `let p = arr.ptr_at(i); p.field = x`.

## 3. `#[abi]` structs cannot be used in events or errors

Status: gap in PR #1606 (`#[abi]` structs); fixed on branch
`fix/abi-struct-sol-compat` (see COMPILER_FIXES.md)

An `#[event]` field of type `DynArray<S>` (or `S`) with `#[abi] struct S` fails
at MIR lowering:

```
MIR lowering failed: unsupported while lowering `emit`: semantic constant
`TOPIC0` referenced from Expr(ExprId(7)) failed CTFE: Ctfe(InvalidBody { .. })
```

The event signature is built from `<T as SolCompat>::SOL_TYPE`, and `#[abi]`
structs do not implement `SolCompat`. The diagnostic does not mention the
missing trait implementation. Seaport needs struct arrays in `OrderFulfilled`,
a struct in `OrderValidated`, and `Side` in errors.

Workaround (before the fix): hand-written `impl SolCompat for S` with the
tuple signature. The fix also needed a CTFE shape check change: a child
value from the generic `DynArray` impl kept the type `(Item::S, String<2>)`
with an unnormalized projection, which the check compared against the
normalized type ("constant child type differs from its aggregate field
type").

## 4. `String<N>` constants silently accept shorter literals

Status: footgun (possibly a bug)

`const SOL_TYPE: String<16> = "(uint8,address,"` (15 bytes) type-checks, but
`AsBytes` then yields 16 bytes with a leading NUL byte. In an event signature
this silently produces a wrong `TOPIC0`
(`keccak("...address,\0(uint8,...")`). Workaround: exact lengths.

## 5. No access to `msize` or numeric pointer values

Status: std/language gap

`std::evm::ops::msize` is `pub(ingot)`, and `*u8` cannot be cast to `u256`
(`error[8-0055]: cast is not provably lossless`). seaport-core's
`_revertWithReasonIfOneIsReturned` only bubbles revert data when the memory
expansion for copying it is affordable, using the free memory pointer. The
port computes the expansion cost from empty memory instead, which can only
make it fall back to the generic error slightly earlier under extreme gas
pressure.

## 6. `fe check` hangs on a pointer reassigned from itself inside a loop

Status: compiler bug (fix branch: TBD)

```fe
use core::ptr
pub fn f(_ data: *u8, n: u256) {
    let mut p = data
    let mut i: u256 = 0
    while i < n {
        p = ptr::offset_bytes(p, 32)
        i += 1
    }
}
```

`fe check` never finishes (100% CPU, observed > 2 minutes). The same
reassignment outside a loop, or `p = other` inside the loop, checks in
~0.1 s. Workaround: derive the pointer from the base and the loop index
(`ptr::offset_bytes(data, i * 32)`) instead of advancing it.

## 7. Effects are not satisfied through supertraits

Status: language limitation (ergonomics)

`RawOps` is declared as `trait RawOps: RawMem + RawStorage`, but a caller
holding `ops: RawOps` cannot call a function that `uses (storage:
RawStorage)`: `error[8-0036]: missing effect RawStorage required by ...`.
Workaround: storage helpers take `ops: RawOps` throughout.

## 8. Aggregate constants through associated type projections

Status: compiler limitation (found while fixing #3)

A constant whose declared type is an associated type projection resolving
to a tuple or struct is rejected when a runtime value is required:

```fe
impl SolCompat for One {
    type S = (String<1>, String<5>, String<1>)
    const SOL_TYPE: Self::S = ("(", "uint8", ")")
}
const X: <One as SolCompat>::S = <One as SolCompat>::SOL_TYPE
// error[8-0064]: const value must be resolvable during type checking
```

`type S = String<7>` works, and CTFE evaluates the aggregate fine (event
`TOPIC0`s built from it are correct). Generated impl consts are validated
with this stricter policy, so the fix for #3 exempts the generated
`SolCompat::SOL_TYPE` (a compile-time-only type name) instead.
