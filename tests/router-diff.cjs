// Differential test: solc SeaportRouter vs Fe SeaportRouter on crafted calldata.
// Run from reference/seaport (pristine artifacts):
//   FE_BUILD=<dir with SeaportRouter.bin> npx hardhat run --no-compile ../../tests/router-diff.cjs
// Both routers get stub Seaports: one reverting with its calldata (exposing the
// forwarded call), ones returning crafted (bool[], Execution[]) data, and one
// reverting with NoSpecifiedOrdersAvailable(), which the router skips. Prints
// every case whose return or revert data differ and exits nonzero if any
// differs other than the documented Panic(0x41) case. No call sends value.
// RELATIVE=1 instead shifts every word of the valid calldata by +-32, +1 and +64.
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
// Hardhat comes from the working directory (reference/seaport), not from
// this script's directory.
const hre = createRequire(path.resolve("package.json"))("hardhat");
const { ethers } = hre;
const FE = process.env.FE_BUILD;
const abiCoder = ethers.utils.defaultAbiCoder;

async function deployRaw(initHex) {
  const [s] = await ethers.getSigners();
  const tx = await s.sendTransaction({ data: initHex });
  const r = await tx.wait();
  return r.contractAddress;
}
// Runtime that reverts with its calldata.
const REVERT_STUB = "0x66365f5f37365ffd5f5260076019f3";
// Runtime that calls the address in its first calldata word with the rest of
// the calldata and returns the success flag word, then the returndata. The
// Seaport Hardhat config sets throwOnCallFailures: false, so an eth_call
// doesn't otherwise tell a revert from a return.
const PROBE = "602036038060205f375f5f825f5f5f355af15f523d5f60203e3d6020015ff3";
function deployCode(runtimeHex) {
  const len = (runtimeHex.length / 2).toString(16).padStart(4, "0");
  // PUSH2 len PUSH2 13 PUSH0 CODECOPY PUSH2 len PUSH0 RETURN
  return "0x61" + len + "61000d5f3961" + len + "5ff3" + runtimeHex;
}
// Runtime returning fixed `data`: PUSH2 len PUSH2 off PUSH0 CODECOPY PUSH2 len PUSH0 RETURN data
// With `revert`, the runtime reverts with `data` instead.
function returnStub(dataHex, revert = false) {
  const data = dataHex.slice(2);
  const len = data.length / 2;
  const code = "61" + len.toString(16).padStart(4, "0") + "6000".slice(0,0) + "61" + (13).toString(16).padStart(4, "0") + "5f39" + "61" + len.toString(16).padStart(4, "0") + (revert ? "5ffd" : "5ff3") + data;
  // runtime prefix is 3+3+2+3+2 = 13 bytes
  const rlen = code.length / 2;
  // init: PUSH2 rlen PUSH2 initlen PUSH0 CODECOPY PUSH2 rlen PUSH0 RETURN
  const init = "61" + rlen.toString(16).padStart(4, "0") + "61" + (13).toString(16).padStart(4, "0") + "5f39" + "61" + rlen.toString(16).padStart(4, "0") + "5ff3";
  return "0x" + init + code;
}

async function main() {
  const solArt = JSON.parse(fs.readFileSync("artifacts/contracts/helpers/SeaportRouter.sol/SeaportRouter.json"));
  const iface = new ethers.utils.Interface(solArt.abi);
  const feInit = "0x" + fs.readFileSync(FE + "/SeaportRouter.bin", "utf8").trim();
  const revertStub = await deployRaw(REVERT_STUB);
  const probe = await deployRaw(deployCode(PROBE));
  const results = [];
  async function routers(seaport, second = seaport) {
    const args = abiCoder.encode(["address", "address"], [seaport, second]).slice(2);
    const sol = await deployRaw(solArt.bytecode + args);
    const fe = await deployRaw(feInit + args);
    return { sol, fe };
  }
  async function call(to, data) {
    const r = await ethers.provider.call({ to: probe, data: "0x" + to.slice(2).padStart(64, "0") + data.slice(2), gasLimit: 3_000_000 });
    return (BigInt(r.slice(0, 66)) === 1n ? "ok:0x" : "revert:0x") + r.slice(66);
  }
  // solc reverts with Panic(0x41) for a length below 2^64 its free-memory
  // pointer can't address, where Fe reverts without data (see README).
  const PANIC_41 = "revert:0x4e487b710000000000000000000000000000000000000000000000000000000000000041";
  let fails = 0, unexpected = 0, n = 0;
  async function compare(name, rs, data) {
    const a = await call(rs.sol, data);
    const b = await call(rs.fe, data);
    n++;
    if (n % 200 == 0) console.log("progress", n, fails);
    if (a !== b) {
      fails++;
      if (!(a === PANIC_41 && b === "revert:0x")) unexpected++;
      console.log("MISMATCH", name, "\n  sol", a.slice(0, 300), "\n  fe ", b.slice(0, 300));
    }
    return a;
  }
  // A positive control: the case must reach the expected outcome, so that
  // a broken setup can't pass by both routers failing early.
  function control(name, outcome, prefix) {
    if (!outcome.startsWith(prefix)) {
      unexpected++;
      console.log("CONTROL", name, "expected", prefix, "got", outcome.slice(0, 80));
    }
  }
  // Seaport's fulfillAvailableAdvancedOrders, which the reverting stub echoes.
  const FORWARDED = "revert:0x87201b41";
  function finish() {
    console.log(`compared ${n}, mismatches ${fails}, unexpected ${unexpected}`);
    if (unexpected > 0) process.exitCode = 1;
  }
  const order = (i) => ({
    parameters: {
      offerer: "0x" + (0x1000 + i).toString(16).padStart(40, "0"),
      zone: "0x" + (0x2000 + i).toString(16).padStart(40, "0"),
      offer: [{ itemType: 2, token: "0x" + "33".repeat(20), identifierOrCriteria: 5, startAmount: 1, endAmount: 1 }],
      consideration: [
        { itemType: 0, token: ethers.constants.AddressZero, identifierOrCriteria: 0, startAmount: 7, endAmount: 8, recipient: "0x" + "44".repeat(20) },
        { itemType: 1, token: "0x" + "55".repeat(20), identifierOrCriteria: 0, startAmount: 9, endAmount: 9, recipient: "0x" + "66".repeat(20) },
      ],
      orderType: 3, startTime: 1, endTime: 2, zoneHash: "0x" + "77".repeat(32), salt: 99, conduitKey: "0x" + "88".repeat(32), totalOriginalConsiderationItems: 2,
    },
    numerator: 1, denominator: 3, signature: "0x" + "ab".repeat(65 + i), extraData: i % 2 ? "0x" : "0x1234",
  });
  const group = (k) => ({
    advancedOrders: [order(k), order(k + 1)],
    criteriaResolvers: [{ orderIndex: 0, side: 1, index: 0, identifier: 3, criteriaProof: ["0x" + "99".repeat(32)] }],
    offerFulfillments: [[{ orderIndex: 0, itemIndex: 0 }], [{ orderIndex: 1, itemIndex: 0 }, { orderIndex: 0, itemIndex: 1 }]],
    considerationFulfillments: [[{ orderIndex: 0, itemIndex: 0 }]],
    etherValue: 0,
  });
  const params = (seaport, groups) => ({
    seaportContracts: groups.map(() => seaport),
    advancedOrderParams: groups,
    fulfillerConduitKey: "0x" + "12".repeat(32),
    recipient: "0x" + "34".repeat(20),
    maximumFulfilled: 5,
  });
  const enc = (p) => iface.encodeFunctionData("fulfillAvailableAdvancedOrders", [p]);

  // 1. Forwarded calldata through the reverting stub.
  let rs = await routers(revertStub);
  const valid = enc(params(revertStub, [group(0), group(5)]));
  control("valid", await compare("valid", rs, valid), FORWARDED);
  await compare("valid-zero-recipient", rs, enc({ ...params(revertStub, [group(0)]), recipient: ethers.constants.AddressZero }));
  await compare("empty-groups", rs, enc(params(revertStub, [])));
  // word-level mutations of the valid calldata
  const words = (valid.length - 10) / 64;
  const mut = (w, v) => valid.slice(0, 10 + w * 64) + v + valid.slice(10 + (w + 1) * 64);
  const muts = [
    "0000000000000000000000000000000000000000000000000000000000000006",
    "0000000000000000000000000000000000000000000000000000000000000005",
    "0000000000000000000000000000000000000000000000000000000000000002",
    "0000000000000000000000000000000000000001000000000000000000000000",
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "0000000000000000000000000000000000000000000000010000000000000000",
    "000000000000000000000000000000000000000000000000ffffffffffffffff",
    "000000000000000000000000000000000000000000000000ffffffffffffff41",
    "000000000000000000000000000000000000000000000000ffffffffffffff40",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000000000000000000000000020",
    "0000000000000000000000000000000000000000000000000000000000001000",
    "0000000000000000000000000000000001000000000000000000000000000000",
    "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0",
  ];
  if (process.env.RELATIVE) {
    for (let w = 0; w < words; w++) {
      const v = ethers.BigNumber.from("0x" + valid.slice(10 + w * 64, 10 + (w + 1) * 64));
      const M = ethers.BigNumber.from(2).pow(256);
      for (const d of [32, -32, 1, 64]) {
        const nv = v.add(d).add(M).mod(M);
        await compare(`w${w}${d > 0 ? "+" : ""}${d}`, rs, mut(w, nv.toHexString().slice(2).padStart(64, "0")));
      }
    }
    finish();
    return;
  }
  for (let w = 0; w < words; w++) for (const m of muts) await compare(`w${w}=${m.slice(-8)}`, rs, mut(w, m));
  // truncations
  for (let cut = 4; cut < valid.length / 2 - 4; cut += 37) await compare(`trunc${cut}`, rs, valid.slice(0, 2 + cut * 2));
  // extra trailing data
  await compare("trailing", rs, valid + "00".repeat(40));
  // fewer groups than seaports
  {
    const p = params(revertStub, [group(0)]);
    p.seaportContracts = [revertStub, revertStub];
    await compare("short-groups", rs, enc(p));
  }
  // not allowed seaport
  await compare("not-allowed", rs, enc(params("0x" + "de".repeat(20), [group(0)])));

  // 2. Returndata decoding through returning stubs.
  const ret = (types, vals) => abiCoder.encode(types, vals);
  const execT = "tuple(tuple(uint8,address,uint256,uint256,address),address,bytes32)[]";
  const goodRet = ret(["bool[]", execT], [[true, true], [[[1, "0x" + "11".repeat(20), 2, 3, "0x" + "22".repeat(20)], "0x" + "33".repeat(20), "0x" + "44".repeat(32)]]]);
  const rets = [goodRet, ret(["bool[]", execT], [[], []])];
  // corrupt variants of goodRet
  const gw = (goodRet.length - 2) / 64;
  for (let w = 0; w < gw; w++) for (const m of [muts[0], muts[2], muts[3], muts[4], muts[5], muts[6], muts[9]]) rets.push(goodRet.slice(0, 2 + w * 64) + m + goodRet.slice(2 + (w + 1) * 64));
  rets.push(goodRet.slice(0, 2 + 60 * 2));
  rets.push("0x");
  for (let k = 0; k < rets.length; k++) {
    const stub = await deployRaw(returnStub(rets[k]));
    const r2 = await routers(stub);
    const p = params(stub, [group(0)]);
    p.maximumFulfilled = 2;
    const outcome = await compare(`ret${k}`, r2, enc(p));
    if (k == 0) control("ret0", outcome, "ok:0x");
  }

  // 3. The second group's forwarded calldata, after the first Seaport
  // returns two available orders or reverts with NoSpecifiedOrdersAvailable().
  const groupType = iface.getFunction("fulfillAvailableAdvancedOrders").inputs[0].components[1].arrayChildren;
  const groupWords = (abiCoder.encode([groupType], [group(5)]).length - 2) / 64 - 1;
  const noOrders = iface.getSighash("NoSpecifiedOrdersAvailable");
  for (const first of [await deployRaw(returnStub(goodRet)), await deployRaw(returnStub(noOrders, true))]) {
    const r3 = await routers(first, revertStub);
    const p = params(revertStub, [group(0), group(5)]);
    p.seaportContracts = [first, revertStub];
    const valid2 = enc(p);
    control("second", await compare("second", r3, valid2), FORWARDED);
    const words2 = (valid2.length - 10) / 64;
    // The calldata ends with the second group's tail.
    for (let w = words2 - groupWords; w < words2; w++) {
      for (const m of [muts[0], muts[3], muts[4], muts[5], muts[9], muts[13]]) {
        await compare(`second-w${w}=${m.slice(-8)}`, r3, valid2.slice(0, 10 + w * 64) + m + valid2.slice(10 + (w + 1) * 64));
      }
    }
  }
  finish();
}
// Hardhat's in-process network keeps the event loop alive, so exit explicitly.
main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => { console.error(e); process.exit(1); },
);
