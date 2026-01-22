const { ethers } = require('ethers');

export {};

async function sendETH() {
  try {
    const PRIVATE_KEY = '0xbcdf20249abf0ed6d944c0288fad489e33f66b3960d9e6229c1cd214ed3bbe31'; // Private key for HD-Wallet index 0
    const TO_ADDRESS = 'YOUR_ADDRESS'; // Replace with recipient address
    const AMOUNT_IN_ETH = '10'; // Amount to send in ETH

    const RPC_URL = 'http://127.0.0.1:32003';
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`Sending from: ${wallet.address}`);
    console.log(`Sending to: ${TO_ADDRESS}`);
    console.log(`Amount: ${AMOUNT_IN_ETH} ETH`);

    const balance = await provider.getBalance(wallet.address);
    console.log(`\nCurrent balance: ${ethers.formatEther(balance)} ETH`);

    const tx = {
      to: TO_ADDRESS,
      value: ethers.parseEther(AMOUNT_IN_ETH)
    };

    console.log('\nSending transaction...');
    const transactionResponse = await wallet.sendTransaction(tx);
    console.log(`Transaction hash: ${transactionResponse.hash}`);

    console.log('Waiting for confirmation...');
    const receipt = await transactionResponse.wait();

    console.log('\n✅ Transaction confirmed!');
    console.log(`Block number: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Transaction fee: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);

    const newBalance = await provider.getBalance(wallet.address);
    console.log(`\nNew balance: ${ethers.formatEther(newBalance)} ETH`);
  } catch (error) {
    console.error('Error sending transaction:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
  }
}

await sendETH();
