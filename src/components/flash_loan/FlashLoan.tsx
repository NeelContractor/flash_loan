"use client"

import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { useFlashLoanProgram, useFlashLoanProgramAccount } from "./flash_loan-data-access";
import { Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import { createInitializeMintInstruction, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, MINT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useState } from "react";
import { BN } from "bn.js";
import { Button } from "../ui/button";
import { WalletButton } from "../solana/solana-provider";

const ADMIN_PUBKEY = new PublicKey("7EpJ8M9MBnN3Jyi7bwKhV9YFCzhDEK7drbMCTRB9Xm8Y");

export default function FlashLoanCreate() {
    const {  publicKey, sendTransaction, signTransaction } = useWallet() ;
    const { connection } = useConnection();
    const { initializePool, deposit, withdraw, repay } = useFlashLoanProgram();
    const [depositAmount, setDepositAmount] = useState<number>(0);
    const [withdrawAmount, setWithdrawAmount] = useState(0);
    // const [mintAddress, setMintAddress] = useState('')

    const handleInitializePool = async() => {
        if (!publicKey) return;

        const mintKeypair = Keypair.generate();
        const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

        const createAccountIx = SystemProgram.createAccount({
            fromPubkey: publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: MINT_SIZE,
            lamports,
            programId: TOKEN_PROGRAM_ID,
        });

        // 2. Initialize mint
        const initMintIx = createInitializeMintInstruction(
            mintKeypair.publicKey,
            6,
            publicKey,
            null
        );

        // 3. Send transaction
        const tx = new Transaction().add(createAccountIx, initMintIx);
        await sendTransaction(tx, connection);

        await initializePool.mutateAsync({ authorityPubkey: publicKey, mintPubkey: mintKeypair.publicKey });
    }

    // const handleDeposit = () => {
    //     if (!publicKey || !depositAmount) return
    
    //     try {
    //         const amount = new BN(parseFloat(depositAmount) * 1e6) // Assuming 6 decimals
    //         const depositorAta = getAssociatedTokenAddressSync(
    //             new PublicKey(mintAddress),
    //             publicKey
    //         )
        
    //         deposit.mutateAsync({
    //             mintPubkey: new PublicKey(mintAddress),
    //             depositorAta,
    //             depositAmount: amount,
    //             depositorPubkey: publicKey,
    //         })
    //         setDepositAmount(0)
    //     } catch (error) {
    //         console.error('Deposit error:', error)
    //     }
    // }

    const handleWithdraw = async({ mintPubkey }: { mintPubkey: PublicKey }) => {
        if (!publicKey) return;

        await withdraw.mutateAsync({ withdrawerPubkey: publicKey, withdrawAmount: new BN(withdrawAmount), mintPubkey });
    }

    const handleRepay = async({ mintPubkey }: { mintPubkey: PublicKey }) => {
        if (!publicKey) return;

        await repay.mutateAsync({ mintPubkey, borrowerPubkey: publicKey });
    }

    return (
        <div className="card bg-base-200 shadow-xl p-5">
          <div className="card-body">
            <h2 className="card-title text-3xl font-bold">Initialize Pool</h2>
            {/* <div className="form-control w-full">
              <label className="label">
                <span className="label-text">Token Mint Address</span>
              </label>
              <input
                type="text"
                placeholder="Enter mint address"
                className="input input-bordered w-full"
                value={mintAddress}
                onChange={(e) => setMintAddress(e.target.value)}
              />
            </div> */}
            <div className="card-actions flex justify-center mt-4">
              <Button
                className="btn btn-primary"
                onClick={handleInitializePool}
                disabled={initializePool.isPending}
              >
                {initializePool.isPending ? 'Initializing...' : 'Initialize Pool'}
              </Button>
            </div>
          </div>
        </div>
    )
}

export function FlashLoanList() {
    const { loanPoolAccounts, getProgramAccount } = useFlashLoanProgram()
  
    if (getProgramAccount.isLoading) {
        return <span className="loading loading-spinner loading-lg"></span>
    }
  
    if (!getProgramAccount.data?.value) {
        return (
            <div className="alert alert-warning">
                <span>Program account not found. Make sure you have deployed the program.</span>
            </div>
        )
    }
  
    return (
        <div className="space-y-4">
            {loanPoolAccounts.isLoading ? (
                <span className="loading loading-spinner loading-lg"></span>
                ) : loanPoolAccounts.data?.length === 0 ? (
                    <div className="alert alert-info">
                        <span>No pools found. Create one to get started!</span>
                    </div>
                ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {loanPoolAccounts.data?.map((account) => (
                        <FlashLoanCard key={account.publicKey.toString()} account={account.publicKey} />
                    ))}
                </div>
            )}
        </div>
    )
}

function FlashLoanCard({ account }: { account: PublicKey }) {
    const { accountQuery } = useFlashLoanProgramAccount({ account: account })
    const { publicKey } = useWallet()
    const { deposit, withdraw } = useFlashLoanProgram()
  
    const [depositAmount, setDepositAmount] = useState('')
    const [withdrawAmount, setWithdrawAmount] = useState('')
    const [borrowAmount, setBorrowAmount] = useState('')
    const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'borrow'>('deposit')
  
    const mintAddress = accountQuery.data?.mint.toString() || ''
  
    const handleDeposit = () => {
        if (!publicKey || !depositAmount) return
    
        try {
            const amount = new BN(parseFloat(depositAmount) * 1e6) // Assuming 6 decimals
            const depositorAta = getAssociatedTokenAddressSync(
                new PublicKey(mintAddress),
                publicKey
            )
    
            deposit.mutateAsync({
                mintPubkey: new PublicKey(mintAddress),
                depositorAta,
                depositAmount: amount,
                depositorPubkey: publicKey,
            })
            setDepositAmount('')
        } catch (error) {
            console.error('Deposit error:', error)
        }
    }
  
    const handleWithdraw = () => {
        if (!publicKey || !withdrawAmount) return
    
        try {
            const amount = new BN(parseFloat(withdrawAmount) * 1e6)
    
            withdraw.mutateAsync({
                mintPubkey: new PublicKey(mintAddress),
                withdrawerPubkey: publicKey,
                withdrawAmount: amount,
            })
            setWithdrawAmount('')
        } catch (error) {
            console.error('Withdraw error:', error)
        }
    }
  
    // const handleBorrow = () => {
    //     if (!publicKey || !borrowAmount) return
    
    //     try {
    //         const amount = new BN(parseFloat(borrowAmount) * 1e6)
    
    //         executeFlashLoan.mutateAsync({
    //             mintPubkey: new PublicKey(mintAddress),
    //             borrowerPubkey: publicKey,
    //             borrowAmount: amount,
    //         })
    //         setBorrowAmount('')
    //     } catch (error) {
    //         console.error('Borrow error:', error)
    //     }
    // }
  
    if (accountQuery.isLoading) {
      return (
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        </div>
      )
    }
  
    const poolData = accountQuery.data
    const totalDeposited = poolData ? Number(poolData.totalDeposited) / 1e6 : 0
    const totalBorrowed = poolData ? Number(poolData.totalBorrowed) / 1e6 : 0
    const totalFees = poolData ? Number(poolData.totalFeesCollected) / 1e6 : 0
    const available = totalDeposited - totalBorrowed
    const feeBps = poolData?.feeBasisPoints || 0
  
    return (
        <div className="card bg-base-200 shadow-xl">
            <div className="card-body">
                <h2 className="card-title text-sm break-all">
                    Pool: {account.toString().slice(0, 8)}...{account.toString().slice(-8)}
                </h2>
        
                <div className="stats stats-vertical shadow bg-base-300 text-xs">
                    <div className="stat py-2">
                        <div className="stat-title text-xs">Total Deposited</div>
                        <div className="stat-value text-lg">{totalDeposited.toFixed(2)}</div>
                    </div>
        
                    <div className="stat py-2">
                        <div className="stat-title text-xs">Available</div>
                        <div className="stat-value text-lg">{available.toFixed(2)}</div>
                    </div>
        
                    <div className="stat py-2">
                        <div className="stat-title text-xs">Currently Borrowed</div>
                        <div className="stat-value text-lg">{totalBorrowed.toFixed(2)}</div>
                    </div>
        
                    <div className="stat py-2">
                        <div className="stat-title text-xs">Fees Collected</div>
                        <div className="stat-value text-lg">{totalFees.toFixed(2)}</div>
                    </div>
        
                    <div className="stat py-2">
                        <div className="stat-title text-xs">Fee Rate</div>
                        <div className="stat-value text-lg">{feeBps / 100}%</div>
                    </div>
                </div>
        
                <div className="divider my-2"></div>
        
                <div className="tabs tabs-boxed">
                    <a
                        className={`tab ${activeTab === 'deposit' ? 'tab-active' : ''}`}
                        onClick={() => setActiveTab('deposit')}
                    >
                    Deposit
                    </a>
                    <a
                        className={`tab ${activeTab === 'withdraw' ? 'tab-active' : ''}`}
                        onClick={() => setActiveTab('withdraw')}
                    >
                    Withdraw
                    </a>
                    <a
                        className={`tab ${activeTab === 'borrow' ? 'tab-active' : ''}`}
                        onClick={() => setActiveTab('borrow')}
                    >
                    Flash Loan
                    </a>
                </div>
        
                {activeTab === 'deposit' && (
                    <div className="form-control w-full mt-4">
                        <label className="label">
                            <span className="label-text">Deposit Amount</span>
                        </label>
                        <input
                            type="number"
                            placeholder="0.00"
                            className="input input-bordered w-full"
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            step="0.01"
                            min="0"
                        />
                        <Button
                            className="btn btn-primary mt-2"
                            onClick={handleDeposit}
                            disabled={!depositAmount || deposit.isPending || !publicKey}
                        >
                            {deposit.isPending ? 'Depositing...' : 'Deposit'}
                        </Button>
                    </div>
                )}
        
                {activeTab === 'withdraw' && (
                    <div className="form-control w-full mt-4">
                        <label className="label">
                            <span className="label-text">Withdraw Amount</span>
                        </label>
                        <input
                            type="number"
                            placeholder="0.00"
                            className="input input-bordered w-full"
                            value={withdrawAmount}
                            onChange={(e) => setWithdrawAmount(e.target.value)}
                            step="0.01"
                            min="0"
                            max={available}
                        />
                        <Button
                            className="btn btn-primary mt-2"
                            onClick={handleWithdraw}
                            disabled={!withdrawAmount || withdraw.isPending || !publicKey}
                        >
                            {withdraw.isPending ? 'Withdrawing...' : 'Withdraw'}
                        </Button>
                    </div>
                )}
        
                {/* {activeTab === 'borrow' && (
                    <div className="form-control w-full mt-4">
                        <label className="label">
                            <span className="label-text">Flash Loan Amount</span>
                        </label>
                        <input
                            type="number"
                            placeholder="0.00"
                            className="input input-bordered w-full"
                            value={borrowAmount}
                            onChange={(e) => setBorrowAmount(e.target.value)}
                            step="0.01"
                            min="0"
                            max={available}
                        />
                        <div className="alert alert-info mt-2 text-xs">
                            <span>Fee: {borrowAmount ? (parseFloat(borrowAmount) * feeBps / 10000).toFixed(4) : '0.00'}</span>
                        </div>
                        <Button
                            className="btn btn-primary mt-2"
                            onClick={handleBorrow}
                            disabled={!borrowAmount || executeFlashLoan.isPending || !publicKey}
                        >
                            {executeFlashLoan.isPending ? 'Executing...' : 'Execute Flash Loan'}
                        </Button>
                    </div>
                )} */}
        
                <div className="divider my-2"></div>
        
                <div className="text-xs text-base-content/70">
                    <p>Mint: {mintAddress.slice(0, 12)}...{mintAddress.slice(-12)}</p>
                </div>
            </div>
        </div>
    )
}
  
export function FlashLoanFeature() {
    return (
        <div className="space-y-8">
            <div className="text-center">
            <h1 className="text-4xl font-bold">Flash Loan Protocol</h1>
            <p className="text-lg text-base-content/70 mt-2">
                Borrow and repay loans within a single transaction
            </p>
            <div>
                <WalletButton />
            </div>
            </div>
    
            <div className="flex justify-center gap-5">
                <FlashLoanCreate />
            </div>
    
            <div className="divider"></div>
    
            <div>
                <h2 className="text-2xl font-bold mb-4">Active Pools</h2>
                <FlashLoanList />
            </div>
        </div>
    )
}