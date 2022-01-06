import { getPathToLatestDeploy } from '../../src/verification/readDeployOutput';
import {deployBridgesHubAndSpoke} from '../../src/bridge';
import * as ethereum from '../../config/mainnets/ethereum';
import * as polygon from '../../config/mainnets/polygon';
import { BridgeDeploy } from '../../src/bridge/BridgeDeploy';

// get the path to the latest core system deploy
const path = getPathToLatestDeploy();

const ethereumDeploy = new BridgeDeploy(
  ethereum.chain,
  ethereum.bridgeConfig,
  path,
);

// TODO: swap for Moonbeam
const polygonDeploy = new BridgeDeploy(
  polygon.chain,
  polygon.bridgeConfig,
  path,
);

deployBridgesHubAndSpoke(ethereumDeploy, [  polygonDeploy]);
