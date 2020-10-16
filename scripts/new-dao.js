const fs = require('fs')
const path = require("path");
const HoneyPotTemplate = artifacts.require("HoneyPotTemplate")
const MiniMeToken = artifacts.require("MiniMeToken")

const FROM_ACCOUNT = "0xdf456B614fE9FF1C7c0B380330Da29C96d40FB02"
const CONFIG_FILE_PATH = '../mock-actions/src/rinkeby-config.json'
const DAO_ID = "honey-pot" + Math.random() // Note this must be unique for each deployment, change it for subsequent deployments
const NETWORK_ARG = "--network"
const DAO_ID_ARG = "--daoid"

const argValue = (arg, defaultValue) => process.argv.includes(arg) ? process.argv[process.argv.indexOf(arg) + 1] : defaultValue
const getLogParameter = (receipt, log, parameter) => receipt.logs.find(x => x.event === log).args[parameter]

const network = () => argValue(NETWORK_ARG, "local")
const daoId = () => argValue(DAO_ID_ARG, DAO_ID)

const honeyTemplateAddress = () => {
  if (network() === "rinkeby") {
    const Arapp = require("../arapp")
    return Arapp.environments.rinkeby.address
  } else if (network() === "mainnet") {
    const Arapp = require("../arapp")
    return Arapp.environments.mainnet.address
  } else if (network() === "xdai") {
    const Arapp = require("../arapp")
    return Arapp.environments.xdai.address
  } else {
    const Arapp = require("../arapp_local")
    return Arapp.environments.devnet.address
  }
}

const getNetworkDependantConfig = () => {
  if (network() === "rinkeby") {
    return networkDependantConfig.rinkeby
  } else if (network() === "xdai") {
    return networkDependantConfig.xdai
  }
}

const getAccount = async () => {
  return (await web3.eth.getAccounts())[0]
}

const DAYS = 24 * 60 * 60
const ONE_HUNDRED_PERCENT = 1e18
const ONE_TOKEN = 1e18

// Create dao transaction one config
const SUPPORT_REQUIRED = 0.5 * ONE_HUNDRED_PERCENT
const MIN_ACCEPTANCE_QUORUM = 0.1 * ONE_HUNDRED_PERCENT
const VOTE_DURATION_BLOCKS = 241920 // ~14 days
const VOTE_BUFFER_BLOCKS = 5760 // 8 hours
const VOTE_EXECUTION_DELAY_BLOCKS = 34560 // 48 hours
const VOTING_SETTINGS = [SUPPORT_REQUIRED, MIN_ACCEPTANCE_QUORUM, VOTE_DURATION_BLOCKS, VOTE_BUFFER_BLOCKS, VOTE_EXECUTION_DELAY_BLOCKS]
const BRIGHTID_1HIVE_CONTEXT = "0x3168697665000000000000000000000000000000000000000000000000000000"
const BRIGHTID_VERIFIER_ADDRESS = "0xead9c93b79ae7c1591b1fb5323bd777e86e150d4";

// Create dao transaction two config
const TOLLGATE_FEE = ONE_TOKEN * 100
const BLOCKS_PER_YEAR = 31557600 / 5 // seeconds per year divided by 15 (assumes 15 second average block time)
const ISSUANCE_RATE = 60e18 / BLOCKS_PER_YEAR // per Block Inflation Rate
const DECAY = 9999799 // 48 hours halftime. 9999599 = 3 days halftime. halftime_alpha = (1/2)**(1/t)
const MAX_RATIO = 1000000 // 10 percent
const MIN_THRESHOLD = 0.01 // half a percent
const WEIGHT = MAX_RATIO ** 2 * MIN_THRESHOLD / 10000000 // determine weight based on MAX_RATIO and MIN_THRESHOLD
const MIN_THRESHOLD_STAKE_PERCENTAGE = 0.2 * ONE_HUNDRED_PERCENT
const CONVICTION_SETTINGS = [DECAY, MAX_RATIO, WEIGHT, MIN_THRESHOLD_STAKE_PERCENTAGE]

// Create dao transaction three config
const SET_APP_FEES_CASHIER = false
const AGREEMENT_TITLE = "1Hive Network Agreement"
const AGREEMENT_CONTENT = "ipfs:QmPvfWUNt3WrZ7uaB1ZwEmec3Zr1ABL9CncSDfQypWkmnp" // Copied from Aragon Network, not 1hive related
const CHALLENGE_DURATION = 3 * DAYS
const ACTION_AMOUNT = 0
const CHALLENGE_AMOUNT = 0
const CONVICTION_VOTING_FEES = [ACTION_AMOUNT, CHALLENGE_AMOUNT]

const networkDependantConfig = {
  rinkeby: {
    ARBITRATOR: "0x35bB112ec8bC897b265E823EA99caEa7Bed03d68",
    STAKING_FACTORY: "0x07429001eeA415E967C57B8d43484233d57F8b0B",
    FEE_TOKEN: "0x848a3752aEcF096B68deb2143714F6b62F899C8e", // Some DAI copy, deployed in the court deployment
    HNY_TOKEN: "0x0000000000000000000000000000000000000000" //"0x658BD9EE8788014b3DBf2bf0d66af344d84a5aA1"
  },
  xdai: {}
}

module.exports = async (callback) => {
  try {
    const honeyPotTemplate = await HoneyPotTemplate.at(honeyTemplateAddress())

    console.log(`Creating DAO...`)
    const createDaoTxOneReceipt = await honeyPotTemplate.createDaoTxOne(
      getNetworkDependantConfig().HNY_TOKEN,
      VOTING_SETTINGS,
      BRIGHTID_1HIVE_CONTEXT,
      BRIGHTID_VERIFIER_ADDRESS
    );

    const daoAddress = getLogParameter(createDaoTxOneReceipt, "DeployDao", "dao")
    const tokenAddress = getLogParameter(createDaoTxOneReceipt, "VoteToken", "voteToken")
    const hookedTokenManagerAddress = getLogParameter(createDaoTxOneReceipt, "HookedTokenManagerAddress", "hookedTokenManagerAddress")
    const agentAddress = getLogParameter(createDaoTxOneReceipt, "AgentAddress", "agentAddress")
    const brightIdRegisterAddress = getLogParameter(createDaoTxOneReceipt, "BrightIdRegisterAddress", "brightIdRegister")
    console.log(`Tx One Complete.
      DAO address: ${ daoAddress }
      Token address: ${ tokenAddress }
      Hooked Token Manager address: ${ hookedTokenManagerAddress }
      Agent address: ${ agentAddress }
      BrightId Register address: ${ brightIdRegisterAddress }
      Gas used: ${ createDaoTxOneReceipt.receipt.gasUsed }`)

    const voteToken = await MiniMeToken.at(tokenAddress);
    if ((await voteToken.controller()).toLowerCase() === FROM_ACCOUNT.toLowerCase()) {
      console.log(`Setting token controller to hooked token manager...`)
      await voteToken.changeController(hookedTokenManagerAddress)
      console.log(`Token controller updated`)
    }

    const createDaoTxTwoReceipt = await honeyPotTemplate.createDaoTxTwo(
      ISSUANCE_RATE,
      CONVICTION_SETTINGS
    )

    const convictionVotingProxy = getLogParameter(createDaoTxTwoReceipt, "ConvictionVotingAddress", "convictionVoting")
    console.log(`Tx Two Complete.
      Conviction Voting address: ${ convictionVotingProxy }
      Gas used: ${ createDaoTxTwoReceipt.receipt.gasUsed }`)

    const createDaoTxThreeReceipt = await honeyPotTemplate.createDaoTxThree(
      getNetworkDependantConfig().ARBITRATOR,
      SET_APP_FEES_CASHIER,
      AGREEMENT_TITLE,
      AGREEMENT_CONTENT,
      getNetworkDependantConfig().STAKING_FACTORY,
      getNetworkDependantConfig().FEE_TOKEN,
      CHALLENGE_DURATION,
      CONVICTION_VOTING_FEES
    )

    const agreementProxy = getLogParameter(createDaoTxThreeReceipt, "AgreementAddress", "agreement")
    console.log(`Tx Three Complete.
      Agreement address: ${ agreementProxy }
      Gas used: ${ createDaoTxThreeReceipt.receipt.gasUsed }`)


    const currentConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, CONFIG_FILE_PATH)).toString())
    const newConfig = {
      ...currentConfig,
      daoAddress,
      brightIdRegisterAddress,
      hookedTokenManagerAddress,
      agentAddress,
      convictionVoting: { ...currentConfig.convictionVoting, proxy: convictionVotingProxy },
      agreement: { ...currentConfig.agreement, proxy: agreementProxy }
    }
    fs.writeFileSync(path.resolve(__dirname, CONFIG_FILE_PATH), JSON.stringify(newConfig))

  } catch (error) {
    console.log(error)
  }
  callback()
}
