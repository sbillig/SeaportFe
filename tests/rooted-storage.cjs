// Run with Hardhat from an isolated upstream harness; see README.
// Each variant starts from the same chain, so receipt gas is comparable.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const workRequire = createRequire(path.resolve("package.json"));
const { ethers, network, artifacts } = workRequire("hardhat");

const { BigNumber: BN } = ethers;
const { defaultAbiCoder: abi, keccak256, hexZeroPad, hexlify } = ethers.utils;
const ROOT = path.resolve(__dirname, "..");
const GUARD = "0x929eee14";
const word = (n) => hexZeroPad(hexlify(BN.from(n)), 32);
const mapSlot = (key, root) =>
  keccak256(abi.encode(["uint256", "uint256"], [key, root]));
const arraySlot = (root) => keccak256(abi.encode(["uint256"], [root]));
const read = async (addr, slot) =>
  BN.from(await ethers.provider.getStorageAt(addr, slot));
const write = (addr, slot, value) =>
  network.provider.send("hardhat_setStorageAt", [
    addr,
    word(slot),
    word(value),
  ]);

async function run(label, build, fallback) {
  await network.provider.send("hardhat_reset");
  const [owner, next, a, b, c] = await ethers.getSigners();
  const gas = {};
  const hashes = {};
  async function tx(name, pending) {
    const receipt = await (await pending).wait();
    gas[name] = receipt.gasUsed.toNumber();
    if (name.endsWith("ConduitOwner")) {
      const cleared =
        name === "cancelConduitOwner" || name === "acceptConduitOwner";
      const events = [
        controller.interface.encodeEventLog(
          controller.interface.getEvent("PotentialOwnerUpdated"),
          [cleared ? ethers.constants.AddressZero : next.address]
        ),
      ];
      if (name === "acceptConduitOwner")
        events.push(
          controller.interface.encodeEventLog(
            controller.interface.getEvent("OwnershipTransferred"),
            [addr, owner.address, next.address]
          )
        );
      assert.deepEqual(
        receipt.logs.map(({ topics, data }) => ({ topics, data })),
        events
      );
    }
    if (process.env.SEAPORT_TRACE_HASHES && name.endsWith("ConduitOwner")) {
      const trace = await network.provider.send("debug_traceTransaction", [
        receipt.transactionHash,
        { disableStorage: true },
      ]);
      assert.equal(trace.failed, false);
      const expectedPreimage = abi
        .encode(["address", "uint256"], [addr, 0])
        .slice(2)
        .toLowerCase();
      const operations = [];
      let total = 0;
      let controllerMap = 0;
      for (const step of trace.structLogs) {
        if (step.depth !== 1) continue;
        if (step.op === "KECCAK256" || step.op === "SHA3") {
          total++;
          const offset = parseInt(step.stack.at(-1), 16);
          const size = parseInt(step.stack.at(-2), 16);
          if (
            size === 64 &&
            step.memory
              .join("")
              .slice(offset * 2, (offset + size) * 2)
              .toLowerCase() === expectedPreimage
          )
            controllerMap++;
        } else if (step.op.startsWith("LOG")) {
          operations.push(step.op);
        } else if (step.op === "SSTORE") {
          const slot = BN.from("0x" + step.stack.at(-1));
          assert(slot.eq(base.add(1)) || slot.eq(base.add(2)));
          operations.push(
            slot.eq(base.add(1)) ? "writeOwner" : "writePotentialOwner"
          );
        }
      }
      assert.deepEqual(
        operations,
        name === "acceptConduitOwner"
          ? ["LOG2", "writePotentialOwner", "LOG4", "writeOwner"]
          : ["LOG2", "writePotentialOwner"]
      );
      hashes[name] = { total, controllerMap, operations };
    }
    return receipt;
  }
  async function deploy(name, args = []) {
    let artifact = await artifacts.readArtifact(name);
    if (build && name !== "TestERC721") {
      artifact.bytecode =
        "0x" + fs.readFileSync(path.join(build, name + ".bin"), "utf8").trim();
    } else {
      artifact = JSON.parse(
        fs.readFileSync(
          path.join(
            ROOT,
            "reference/seaport/artifacts",
            artifact.sourceName,
            name + ".json"
          )
        )
      );
    }
    // Force just the constructor's TLOAD feature probe to fail. The compiler
    // targets Cancun, so running its entire output on Shanghai is invalid.
    // This mutation is confined to test initcode, for both Solidity and Fe.
    if (fallback && name === "Seaport") {
      const payload = "6002601e613d5c3d52f3";
      assert.equal(artifact.bytecode.split(payload).length, 2);
      artifact.bytecode = artifact.bytecode.replace(
        payload,
        "6002601e61fefe3d52f3"
      );
    }
    const contract = await new ethers.ContractFactory(
      artifact.abi,
      artifact.bytecode,
      owner
    ).deploy(...args, { gasLimit: 100_000_000 });
    await contract.deployed();
    return contract;
  }
  const controller = await deploy("ConduitController");
  const key = ethers.utils.hexConcat([owner.address, hexZeroPad("0x1234", 12)]);
  await tx("createConduit", controller.createConduit(key, owner.address));
  const [addr, exists] = await controller.getConduit(key);
  assert(exists);
  const conduit = new ethers.Contract(
    addr,
    (await artifacts.readArtifact("Conduit")).abi,
    owner
  );
  const base = BN.from(mapSlot(addr, 0));
  assert((await read(controller.address, base)).eq(key));
  assert((await read(controller.address, base.add(1))).eq(owner.address));
  assert((await read(controller.address, base.add(2))).isZero());

  for (const [i, channel] of [a, b, c].entries()) {
    await tx(
      "openChannel" + i,
      controller.updateChannel(addr, channel.address, true)
    );
    assert((await read(addr, mapSlot(channel.address, 0))).eq(1));
    assert(
      (
        await read(controller.address, mapSlot(channel.address, base.add(4)))
      ).eq(i + 1)
    );
  }
  assert((await read(controller.address, base.add(3))).eq(3));
  const data = BN.from(arraySlot(base.add(3)));
  assert((await read(controller.address, data.add(1))).eq(b.address));
  await tx(
    "removeMiddleChannel",
    controller.updateChannel(addr, b.address, false)
  );
  assert.deepEqual(await controller.getChannels(addr), [a.address, c.address]);
  assert((await read(controller.address, data.add(1))).eq(c.address));
  assert((await read(controller.address, data.add(2))).isZero());
  assert(
    (await read(controller.address, mapSlot(b.address, base.add(4)))).isZero()
  );
  assert(
    (await read(controller.address, mapSlot(c.address, base.add(4)))).eq(2)
  );
  assert((await read(addr, mapSlot(b.address, 0))).isZero());

  async function reverts(contract, method, args, signature) {
    try {
      await contract.callStatic[method](...args);
      assert.fail("expected " + signature);
    } catch (error) {
      assert.equal(
        error.data?.slice(0, 10),
        ethers.utils.id(signature).slice(0, 10),
        String(error)
      );
    }
  }
  await reverts(
    controller,
    "updateChannel",
    [addr, a.address, true],
    "ChannelStatusAlreadySet(address,bool)"
  );
  await reverts(
    controller,
    "getChannel",
    [addr, 2],
    "ChannelOutOfRange(address)"
  );
  await tx(
    "removeLastChannel",
    controller.updateChannel(addr, c.address, false)
  );
  await tx(
    "removeOnlyChannel",
    controller.updateChannel(addr, a.address, false)
  );
  await tx("reopenChannel", controller.updateChannel(addr, b.address, true));
  assert.deepEqual(await controller.getChannels(addr), [b.address]);
  await reverts(
    controller,
    "cancelOwnershipTransfer",
    [addr],
    "NoPotentialOwnerCurrentlySet(address)"
  );
  await tx(
    "transferConduitOwner",
    controller.transferOwnership(addr, next.address)
  );
  assert((await read(controller.address, base.add(2))).eq(next.address));
  await tx("cancelConduitOwner", controller.cancelOwnershipTransfer(addr));
  assert((await read(controller.address, base.add(2))).isZero());
  await tx(
    "restartConduitOwner",
    controller.transferOwnership(addr, next.address)
  );
  assert((await read(controller.address, base.add(2))).eq(next.address));
  await tx(
    "acceptConduitOwner",
    controller.connect(next).acceptOwnership(addr)
  );
  assert((await read(controller.address, base.add(1))).eq(next.address));
  assert((await read(controller.address, base.add(2))).isZero());

  const zones = await deploy("PausableZoneController", [owner.address]);
  assert((await read(zones.address, 0)).eq(owner.address));
  const receipt = await tx("createZone", zones.createZone(word(7)));
  const zoneAddr = receipt.events.find((event) => event.event === "ZoneCreated")
    .args.zone;
  const zone = new ethers.Contract(
    zoneAddr,
    (await artifacts.readArtifact("PausableZone")).abi,
    owner
  );
  await tx("assignOperator", zones.assignOperator(zoneAddr, a.address));
  assert((await read(zoneAddr, 0)).eq(a.address));
  // Unused high bits survive both packed-field updates.
  const high = BN.from(1).shl(230);
  await write(zoneAddr, 0, high.or(BN.from(a.address)));
  await zones.assignOperator(zoneAddr, b.address);
  assert((await read(zoneAddr, 0)).eq(high.or(BN.from(b.address))));
  await tx("pauseZone", zones.pause(zoneAddr));
  assert(
    (await read(zoneAddr, 0)).eq(
      high.or(BN.from(b.address)).or(BN.from(1).shl(160))
    )
  );
  assert(await zone.isPaused());
  assert.equal(await zone.operator(), b.address);
  await zones.assignPauser(c.address);
  assert((await read(zones.address, 2)).eq(c.address));
  await zones.transferOwnership(next.address);
  assert((await read(zones.address, 1)).eq(next.address));
  await zones.connect(next).acceptOwnership();
  assert((await read(zones.address, 0)).eq(next.address));
  assert((await read(zones.address, 1)).isZero());

  const seaport = await deploy("Seaport", [controller.address]);
  const counter = mapSlot(owner.address, 0);
  const nonce = mapSlot(owner.address, 2);
  await write(seaport.address, counter, 42);
  await write(seaport.address, nonce, ethers.constants.MaxUint256);
  assert((await seaport.getCounter(owner.address)).eq(42));
  assert(
    (await seaport.getContractOffererNonce(owner.address)).eq(
      ethers.constants.MaxUint256
    )
  );
  const components = {
    offerer: owner.address,
    zone: ethers.constants.AddressZero,
    offer: [],
    consideration: [],
    orderType: 0,
    startTime: 0,
    endTime: ethers.constants.MaxUint256,
    zoneHash: word(0),
    salt: 7,
    conduitKey: word(0),
    counter: 42,
  };
  let hash = await seaport.getOrderHash(components);
  const status = mapSlot(hash, 1);
  const fraction = BN.from(7).shl(16).or(BN.from(11).shl(136));
  await write(seaport.address, status, fraction.or(0xabcd));
  const decoded = await seaport.getOrderStatus(hash);
  assert(decoded[0] && decoded[1]);
  assert(decoded[2].eq(7) && decoded[3].eq(11));
  await tx("cancelOrder", seaport.cancel([components]));
  assert((await read(seaport.address, status)).eq(fraction.or(0x100)));
  const parameters = {
    ...components,
    salt: 8,
    totalOriginalConsiderationItems: 0,
  };
  hash = await seaport.getOrderHash({ ...components, salt: 8 });
  const validateSlot = mapSlot(hash, 1);
  await write(seaport.address, validateSlot, BN.from(11).shl(136));
  await tx(
    "validateOrder",
    seaport.validate([{ parameters, signature: "0x" }])
  );
  assert(
    (await read(seaport.address, validateSlot)).eq(BN.from(11).shl(136).or(1))
  );
  const increment = await tx("incrementCounter", seaport.incrementCounter());
  const previous = await ethers.provider.getBlock(increment.blockNumber - 1);
  const expected = BN.from(previous.hash)
    .shr(128)
    .add(42)
    .and(ethers.constants.MaxUint256);
  assert((await read(seaport.address, counter)).eq(expected));

  const nft = await deploy("TestERC721");
  await nft.mint(owner.address, 1);
  await nft.setApprovalForAll(seaport.address, true);
  const trade = {
    ...parameters,
    salt: 9,
    offer: [
      {
        itemType: 2,
        token: nft.address,
        identifierOrCriteria: 1,
        startAmount: 1,
        endAmount: 1,
      },
    ],
    consideration: [
      {
        itemType: 0,
        token: ethers.constants.AddressZero,
        identifierOrCriteria: 0,
        startAmount: 10,
        endAmount: 10,
        recipient: owner.address,
      },
    ],
    totalOriginalConsiderationItems: 1,
  };
  const tradeHash = await seaport.getOrderHash({ ...trade, counter: expected });
  await tx(
    "fulfillAdvancedOrder",
    seaport.fulfillAdvancedOrder(
      {
        parameters: trade,
        numerator: 1,
        denominator: 1,
        signature: "0x",
        extraData: "0x",
      },
      [],
      word(0),
      next.address,
      { value: 10 }
    )
  );
  assert.equal(await nft.ownerOf(1), next.address);
  assert(
    (await read(seaport.address, mapSlot(tradeHash, 1))).eq(
      BN.from(1).shl(136).or(BN.from(1).shl(16)).or(1)
    )
  );

  const persistent = await read(seaport.address, GUARD);
  const probe = ethers.utils.getContractAddress({
    from: seaport.address,
    nonce: 1,
  });
  assert.equal(
    await ethers.provider.getCode(probe),
    fallback ? "0xfefe" : "0x3d5c"
  );
  assert.equal(persistent.toNumber(), fallback ? 1 : 0);
  if (persistent.eq(1)) {
    await reverts(seaport, "__activateTstore", [], "TStoreNotSupported()");
    await write(seaport.address, GUARD, 2);
    await reverts(seaport, "incrementCounter", [], "NoReentrantCalls()");
    await write(seaport.address, GUARD, 3);
    await tx(
      "receiveNative",
      owner.sendTransaction({ to: seaport.address, value: 1 })
    );
    await write(seaport.address, GUARD, 1);
    const rejected = await network.provider.send("eth_call", [
      { to: seaport.address, value: "0x1", data: "0x" },
      "latest",
    ]);
    assert.equal(
      rejected,
      ethers.utils.id("InvalidMsgValue(uint256)").slice(0, 10) +
        abi.encode(["uint256"], [1]).slice(2)
    );
    await network.provider.send("hardhat_setCode", [probe, "0x00"]);
    await tx("activateTstore", seaport.__activateTstore());
    assert((await read(seaport.address, GUARD)).isZero());
    await reverts(seaport, "__activateTstore", [], "TStoreAlreadyActivated()");
  } else {
    assert(persistent.isZero());
    await reverts(seaport, "__activateTstore", [], "TStoreAlreadyActivated()");
  }
  return { label, fallback, gas, hashes };
}

async function main() {
  const variants = process.env.SEAPORT_VARIANTS
    ? JSON.parse(process.env.SEAPORT_VARIANTS)
    : [
        ["solidity", null],
        ["fe", path.join(ROOT, "build/fe")],
      ];
  const results = [];
  for (const [label, build] of variants) {
    for (const fallback of [false, true]) {
      results.push(await run(label, build, fallback));
      console.log(
        label + ": rooted storage checks passed (fallback=" + fallback + ")"
      );
    }
  }
  if (process.env.SEAPORT_REPORT)
    fs.writeFileSync(
      process.env.SEAPORT_REPORT,
      JSON.stringify(results, null, 2) + "\n"
    );
  console.log(JSON.stringify(results, null, 2));
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
