/*
- Bee Compound 2 - 
This strategy involves triggering the compound function on the BUSD vault contract every 12 hours, and claim 48 hrs after 10 compounds are done in order to receive the maximum payout rewards from the ROI dapp. A notification email report is then sent via email to update the status of the wallets. This compound bot supports multiple wallets and just loops through all of them. Just change the 'initWallets' code to the number you like!  

URL: https://busd.bee-n-bee.io/?ref=0xFdD831b51DCdA2be256Edf12Cd81C6Af79b6D7Df
*/

// Import required node modules
const scheduler = require("node-schedule");
const nodemailer = require("nodemailer");
const { ethers } = require("ethers");
const figlet = require("figlet");
const ABI = require("./abi");
require("dotenv").config();
const fs = require("fs");

// Import the environment variables
const VAULT = process.env.CONTRACT_ADR;
const RPC_URL = process.env.BSC_RPC;

// BUSD contract details for ERC-20
const BUSD = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56";
const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) external returns (bool)",
];

// Storage obj
var restakes = {
  previousRestake: "",
  nextRestake: "",
  previousTVL: "",
  previousApr: "",
  previousAvg: 0,
  withdrawing: false,
};

// Main Function
const main = async () => {
  let restakeExists = false;
  try {
    // check if restake file exists
    if (!fs.existsSync("./restakes.json")) await storedData();
    // get stored values from file
    const storedData = JSON.parse(fs.readFileSync("./restakes.json"));
    // not first launch, check data
    if ("nextRestake" in storedData) {
      const nextRestake = new Date(storedData.nextRestake);
      // restore claims schedule
      if (nextRestake > new Date()) {
        // check if withdrawing
        if (storedData.withdrawing) {
          scheduler.scheduleJob(nextRestake, WithdrawFunds);
          console.log("Restored Withdraw: " + nextRestake);
        } else {
          scheduler.scheduleJob(nextRestake, BeeCompound);
          console.log("Restored Restake: " + nextRestake);
        }
        restakeExists = true;
      }
    }
  } catch (error) {
    console.error(error);
  }
  // first time, no previous launch
  if (!restakeExists) BeeCompound();
};

// Import wallet detail
const initWallets = (n) => {
  let wallets = [];
  for (let i = 1; i <= n; i++) {
    const wallet = {
      address: process.env["ADR_" + i],
      key: process.env["PVK_" + i],
      index: i,
    };
    wallets.push(wallet);
  }
  return wallets;
};

// Ethers connect on each wallet
const connect = async (wallet) => {
  let connection = {};

  // Add connection properties
  connection.provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  connection.wallet = new ethers.Wallet(wallet.key, connection.provider);
  connection.busd = new ethers.Contract(BUSD, ERC20, connection.wallet);
  connection.contract = new ethers.Contract(VAULT, ABI, connection.wallet);

  // connection established
  await connection.provider.getBalance(wallet.address);
  return connection;
};

// BUSD Compound Function
const BeeCompound = async () => {
  // start function
  console.log("\n");
  console.log(
    figlet.textSync("BeeCompound", {
      font: "Standard",
      horizontalLayout: "default",
      verticalLayout: "default",
      width: 80,
      whitespaceBreak: true,
    })
  );

  // get wallet detail from .env
  const wallets = initWallets(5);
  let curr_comp = Infinity;

  // storage array for sending reports
  let report = ["BUSD Report " + todayDate()];
  let balances = [];

  // store last compound, schedule next
  let previousRestake = new Date();
  restakes.previousRestake = previousRestake.toString();

  // loop through for each wallet
  for (const wallet of wallets) {
    try {
      // connection using the current wallet
      const connection = await connect(wallet);
      const mask =
        wallet.address.slice(0, 5) + "..." + wallet.address.slice(-6);

      // call the compoundHoney function and await results
      const result = await connection.contract.compoundHoney(true);
      const receipt = await result.wait();

      // succeeded
      if (receipt) {
        // get the total balance currently locked in the vault
        const u = await connection.contract.getUserInfo(wallet.address);
        const balance = ethers.utils.formatEther(u["_compoundedDeposit"]);
        console.log(`Wallet${wallet["index"]}: success`);
        console.log(`Vault Balance: ${balance} BUSD`);

        // get how many accumulated compounds have been done
        const compounds = Number(u["_compounds"].toString());
        curr_comp = Math.min(compounds, curr_comp);

        const success = {
          index: wallet.index,
          wallet: mask,
          balance: balance,
          compounds: compounds,
          compound: true,
        };

        // store the timestamp to plan for restake
        const timestamp = u["_lastCompoundTimestamp"];
        previousRestake = new Date(timestamp * 1000);
        balances.push(parseFloat(balance));
        report.push(success);
      }
    } catch (error) {
      console.log(`Wallet${wallet["index"]}: failed!`);
      console.error(error);
      const mask =
        wallet.address.slice(0, 5) + "..." + wallet.address.slice(-6);

      // failed
      const fail = {
        index: wallet.index,
        wallet: mask,
        compound: false,
      };

      curr_comp = 0;
      report.push(fail);
    }
  }

  // calculate the average wallet size and the effective APR
  const average = eval(balances.join("+")) / balances.length;
  const apr = calculateAPR(restakes.previousAvg, average, 12);
  report.push({ average: average, dailyAPR: apr });

  // get required min compounds from contract
  const minComp = (await minCompounds()) || 10;

  // if the minComp is met
  if (curr_comp >= minComp) {
    restakes.withdrawing = true;
    // withdraw funds after waiting for 48 hrs
    scheduleNext(WithdrawFunds, previousRestake, 48);
    report.push("WITHDRAWING IN 48 HOURS!");
  } else {
    // just continue compounding as per normal
    scheduleNext(BeeCompound, previousRestake, 12);
  }

  // send status update report
  report.push({ ...restakes });
  restakes.previousAvg = average;
  restakes.previousApr = apr;
  sendReport(report);
};

// Calculate APR Function
const calculateAPR = (prevBal, currBal, t) => {
  if (!prevBal || !currBal) return;
  prevBal = Number(prevBal);
  currBal = Number(currBal);
  t = 24 / t;

  // calculate and return the effective APR
  let interest = (currBal - prevBal) / prevBal;
  interest = (interest * 100 * t).toFixed(3);
  return `${interest}%`;
};

// Withdraw Claims Function
const WithdrawFunds = async () => {
  // start function
  console.log("\n");
  console.log(
    figlet.textSync("WithdrawFunds", {
      font: "Standard",
      horizontalLayout: "default",
      verticalLayout: "default",
      width: 80,
      whitespaceBreak: true,
    })
  );

  // get wallet detail from .env
  const wallets = initWallets(5);

  // storage array for sending reports
  let report = ["BUSD Withdrawal: " + todayDate()];

  // store last compound, schedule next
  let previousRestake = new Date();
  restakes.previousRestake = previousRestake.toString();

  // loop through for each wallet
  for (const wallet of wallets) {
    try {
      // connection using the current wallet
      const connection = await connect(wallet);
      const mask =
        wallet.address.slice(0, 5) + "..." + wallet.address.slice(-6);

      // get required min compounds from contract
      const minComp = (await minCompounds()) || 10;

      // get the total compounds for the current wallet
      const u = await connection.contract.getUserInfo(wallet.address);
      const compounds = Number(u["_compounds"].toString());

      // minimum compounds is not met
      if (compounds < minComp) continue;

      // call the sellHoney function and await the results
      const result = await connection.contract.sellHoney();
      const receipt = await result.wait();

      // succeeded
      if (receipt) {
        // get the total balance currently locked in the vault
        const u = await connection.contract.getUserInfo(wallet.address);
        const balance = ethers.utils.formatEther(u["_compoundedDeposit"]);
        console.log(`Wallet${wallet["index"]}: success`);
        console.log(`Vault Balance: ${balance} BUSD`);
        const compounds = Number(u["_compounds"].toString());
        restakes.withdrawing = false;

        // get the BUSD balance of the current wallet
        const busd = await connection.busd.balanceOf(wallet.address);
        const busd_bal = ethers.utils.formatEther(busd);

        const success = {
          index: wallet.index,
          wallet: mask,
          busd: busd_bal,
          vault: balance,
          compounds: compounds,
          withdraw: true,
        };

        // store the timestamp to plan for restake
        const timestamp = u["_lastCompoundTimestamp"];
        previousRestake = new Date(timestamp * 1000);
        transferFunds(connection, busd);
        report.push(success);
      }
    } catch (error) {
      console.log(`Wallet${wallet["index"]}: failed!`);
      console.error(error);
      const mask =
        wallet.address.slice(0, 5) + "..." + wallet.address.slice(-6);

      // failed
      const fail = {
        index: wallet.index,
        wallet: mask,
        withdraw: false,
      };

      report.push(fail);
    }
  }

  // just resume compounding back to normal
  scheduleNext(BeeCompound, previousRestake, 12);

  // send status update report
  report.push({ ...restakes });
  sendReport(report);
};

// Consolidate Funds Function
const transferFunds = async (con, amt) => {
  // get main wallet details
  const wallets = initWallets(5);
  const mainWallet = wallets[4];

  // transfer funds to the main wallet
  con.busd.transfer(mainWallet.address, amt);
};

// Job Scheduler Function
const scheduleNext = async (func, nextDate, x) => {
  // set next job to be x hrs from now
  nextDate.setHours(nextDate.getHours() + x);
  restakes.nextRestake = nextDate.toString();
  console.log("Next Restake: ", nextDate);

  // schedule next restake
  scheduler.scheduleJob(nextDate, func);
  storeData();
  return;
};

// Data Storage Function
const storeData = async () => {
  const data = JSON.stringify(restakes);
  fs.writeFile("./restakes.json", data, (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log("Data stored:", restakes);
    }
  });
};

// Current Date function
const todayDate = () => {
  const today = new Date();
  return today.toLocaleString("en-GB", { timeZone: "Asia/Singapore" });
};

// Contract TVL Function
const contractTVL = async () => {
  // just initialize connection
  const wallets = initWallets(1);
  const connection = await connect(wallets[0]);
  const balance = await connection.busd.balanceOf(VAULT);
  const formattedBal = ethers.utils.formatEther(balance);
  const delta = calculateAPR(restakes.previousTVL, formattedBal, 24);
  restakes.previousTVL = formattedBal;
  return { tvl: formattedBal, change: delta };
};

// Minimum Claims Function
const minCompounds = async () => {
  // just initialize connection
  const wallets = initWallets(1);
  const connection = await connect(wallets[0]);

  // get the minimum required compounds for claim
  const min = await connection.contract.COMPOUNDS_FOR_NO_PENALTY();
  const result = Number(min.toString());
  return result;
};

// Send Report Function
const sendReport = async (report) => {
  // get the formatted date
  const today = todayDate();

  // get contract BUSD balance
  const balance = await contractTVL();
  report.push(balance);
  console.log(report);

  // configure email server
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_ADDR,
      pass: process.env.EMAIL_PW,
    },
  });

  // setup mail params
  const mailOptions = {
    from: process.env.EMAIL_ADDR,
    to: process.env.RECIPIENT,
    subject: "Bee Report: " + today,
    text: JSON.stringify(report, null, 2),
  };

  // send the email message
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });
};

main();
