import { Effects, Config, SetResult, YAML, matches } from "../deps.ts";
import { SetConfig, setConfigMatcher } from "../models/setConfig.ts";
import { Alias, getAlias } from "./getAlias.ts";

const { string } = matches;

const regexUrl = /^(\w+:\/\/)?(.*?)(:\d{0,4})?$/m;
function urlParse(input: string) {
  const url = new URL(input)
  const [, _protocol, host, port] = Array.from(regexUrl.exec(input) || []);
  return {
    host,
    port,
  };
}
async function createWaitForService(effects: Effects, config: SetConfig) {
  const { bitcoin_rpc_host, bitcoin_rpc_pass, bitcoin_rpc_port, bitcoin_rpc_user } = userInformation(config);
  await effects.writeFile({
    path: "start9/waitForStart.sh",
    toWrite: `
    #!/bin/sh
    echo "Starting Wait for Bitcoin Start"
    while true; do
      bitcoin-cli -rpcconnect=${bitcoin_rpc_host} -rpcport=${bitcoin_rpc_port} -rpcuser=${bitcoin_rpc_user} -rpcpassword=${bitcoin_rpc_pass} getblockchaininfo 2> /dev/null
      if [ $? -eq 0 ] 
      then 
        break
      else 
        echo "Waiting for Bitcoin to start..."
        sleep 1
      fi
    done    
    `,
    volumeId: "main",
  });
}

function parseQuickCOnnectUrl(url: string): {
  bitcoin_rpc_user: string;
  bitcoin_rpc_pass: string;
  bitcoin_rpc_host: string;
  bitcoin_rpc_port: number;
} {
  const { host, port } = urlParse(url);
  const portNumber = port == null ? null : Number(port);

  if (!string.test(host)) {
    throw new Error(`Expecting '${url}' to have a host`);
  }
  const [auth, bitcoin_rpc_host] = host.split("@");
  if (!string.test(bitcoin_rpc_host)) {
    throw new Error(`Expecting '${url}' to have a host with auth`);
  }
  const [user, pass] = auth.split(":");

  if (!string.test(user)) {
    throw new Error(`Expecting '${url}' to have a username`);
  }
  if (!string.test(pass)) {
    throw new Error(`Expecting '${url}' to have a password`);
  }
  return {
    bitcoin_rpc_user: user,
    bitcoin_rpc_pass: pass,
    bitcoin_rpc_host,
    bitcoin_rpc_port: portNumber ?? 8332,
  };
}
function userInformation(config: SetConfig) {
  switch (config.bitcoind.type) {
    case "internal":
      return {
        bitcoin_rpc_user: config.bitcoind.user,
        bitcoin_rpc_pass: config.bitcoind.password,
        bitcoin_rpc_host: "bitcoind.embassy",
        bitcoin_rpc_port: 8332,
      };

    case "internal-proxy":
      return {
        bitcoin_rpc_user: config.bitcoind.user,
        bitcoin_rpc_pass: config.bitcoind.password,
        bitcoin_rpc_host: "btc-rpc-proxy.embassy",
        bitcoin_rpc_port: 8332,
      };
  }
}

function configMaker(alias: Alias, config: SetConfig) {
  const { bitcoin_rpc_host, bitcoin_rpc_pass, bitcoin_rpc_port, bitcoin_rpc_user } = userInformation(config);
  const rpcBind = config.rpc.enabled ? "0.0.0.0:8080" : "127.0.0.1:8080";
  const enableWumbo = config.advanced["wumbo-channels"] ? "large-channels" : "";
  const enableExperimentalDualFund = config.advanced.experimental["dual-fund"] ? "experimental-dual-fund" : "";
  const enableExperimentalOnionMessages = config.advanced.experimental["onion-messages"]
    ? "experimental-onion-messages"
    : "";
  const enableExperimentalOffers = config.advanced.experimental.offers ? "experimental-offers" : "";
  const enableExperimentalShutdownWrongFunding = config.advanced.experimental["shutdown-wrong-funding"]
    ? "experimental-shutdown-wrong-funding"
    : "";
  const enableHttpPlugin = config.advanced.plugins.http
    ? "plugin=/usr/local/libexec/c-lightning/plugins/c-lightning-http-plugin"
    : "";
  const enableRebalancePlugin = config.advanced.plugins.rebalance
    ? "plugin=/usr/local/libexec/c-lightning/plugins/rebalance/rebalance.py"
    : "";
  const enableSummaryPlugin = config.advanced.plugins.summary
    ? "plugin=/usr/local/libexec/c-lightning/plugins/summary/summary.py"
    : "";
  const enableRestPlugin = config.advanced.plugins.rest
    ? "plugin=/usr/local/libexec/c-lightning/plugins/c-lightning-REST/plugin.js\n\
  rest-port=3001\n\
  rest-protocol=https\n\
  "
    : "";

  return `
  network=bitcoin
  bitcoin-rpcuser=${bitcoin_rpc_user}
  bitcoin-rpcpassword=${bitcoin_rpc_pass}
  bitcoin-rpcconnect=${bitcoin_rpc_host}
  bitcoin-rpcport=${bitcoin_rpc_port}
  
  http-user=${config.rpc.user}
  http-pass=${config.rpc.password}
  http-bind=${rpcBind}
  bind-addr=0.0.0.0:9735
  announce-addr=${config["peer-tor-address"]}:9735
  proxy={proxy}
  always-use-proxy=${config.advanced["tor-only"]}
  
  alias=${alias}
  rgb=${config.color}
  
  fee-base=${config.advanced["fee-base"]}
  fee-per-satoshi=${config.advanced["fee-rate"]}
  min-capacity-sat=${config.advanced["min-capacity"]}
  ignore-fee-limits=${config.advanced["ignore-fee-limits"]}
  funding-confirms=${config.advanced["funding-confirms"]}
  cltv-delta=${config.advanced["cltv-delta"]}
  ${enableWumbo}
  ${enableExperimentalDualFund}
  ${enableExperimentalOnionMessages}
  ${enableExperimentalOffers}
  ${enableExperimentalShutdownWrongFunding}
  
  ${enableHttpPlugin}
  ${enableRebalancePlugin}
  ${enableSummaryPlugin}
  ${enableRestPlugin}
`;
}

export async function setConfig(effects: Effects, input: Config): Promise<SetResult> {
  const config = setConfigMatcher.unsafeCast(input);
  const alias = await getAlias(effects, config);
  await effects.createDir({
    path: "start9",
    volumeId: "main",
  });
  await effects.writeFile({
    path: "start9/config.yaml",
    toWrite: YAML.stringify(input),
    volumeId: "main",
  });

  await effects.writeFile({
    path: "config.main",
    toWrite: configMaker(alias, config),
    volumeId: "main",
  });

  await createWaitForService(effects, config);

  return {
    signal: "SIGTERM",
    "depends-on": {},
  };
}
