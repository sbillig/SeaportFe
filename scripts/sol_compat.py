#!/usr/bin/env python3
"""Print `impl SolCompat` blocks with exactly sized `String<N>` chunks.

Fe's `String<N>` holds at most 31 bytes and must be sized exactly (a shorter
literal is left-padded with NUL bytes, see ISSUES.md #4), so long Solidity
tuple signatures are split into chunks here.
"""
import sys

ITEM = "(uint8,address,uint256,uint256,uint256)"
CITEM = "(uint8,address,uint256,uint256,uint256,address)"
TYPES = {
    "OfferItem": ITEM,
    "ConsiderationItem": CITEM,
    "SpentItem": "(uint8,address,uint256,uint256)",
    "ReceivedItem": "(uint8,address,uint256,uint256,address)",
    "OrderParameters": f"(address,address,{ITEM}[],{CITEM}[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256)",
}


def chunks(s, n=31):
    return [s[i:i + n] for i in range(0, len(s), n)]


def impl(name, sig):
    parts = chunks(sig)
    ty = ", ".join(f"String<{len(p)}>" for p in parts)
    val = ", ".join(f'"{p}"' for p in parts)
    if len(parts) == 1:
        return f"impl SolCompat for {name} {{\n    type S = {ty}\n    const SOL_TYPE: Self::S = {val}\n}}\n"
    return f"impl SolCompat for {name} {{\n    type S = ({ty})\n    const SOL_TYPE: Self::S = ({val})\n}}\n"


for name in sys.argv[1:] or TYPES:
    print(impl(name, TYPES[name]))
