import path from "node:path";
import config from "../reference/seaport/hardhat.config";

config.paths = {
  ...config.paths,
  root: path.resolve(__dirname, "../reference/seaport"),
};
config.networks ??= {};
config.networks.hardhat = {
  ...config.networks.hardhat,
  allowUnlimitedContractSize: true,
  blockGasLimit: 1_000_000_000,
  hardfork: "cancun",
  throwOnCallFailures: false,
};

export default config;
