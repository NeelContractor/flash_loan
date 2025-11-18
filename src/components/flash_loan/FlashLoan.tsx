"use client"

import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { useFlashLoanProgram, useFlashLoanProgramAccount } from "./flash_loan-data-access"
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js"
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token"
import { useState } from "react"
import { BN } from "bn.js"
import { Button } from "../ui/button"
import { WalletButton } from "../solana/solana-provider"

// ADMIN COMPONENT - Create mint and initialize pool (ONCE)
export function AdminInitializePool() {
    const { publicKey, sendTransaction } = useWallet()
    const { connection } = useConnection()
    const { initializePool, program, loanPoolAccounts } = useFlashLoanProgram()
    const [isCreating, setIsCreating] = useState(false)
    const [createdMintAddress, setCreatedMintAddress] = useState<string>('')
    const [createdPoolAddress, setCreatedPoolAddress] = useState<string>('')
    const [showSuccess, setShowSuccess] = useState(false)

    // Check if user is admin (you can customize this check)
    const isAdmin = publicKey?.toString() === "7EpJ8M9MBnN3Jyi7bwKhV9YFCzhDEK7drbMCTRB9Xm8Y"

    const handleCreatePoolOnce = async () => {
        if (!publicKey) return

        try {
            setIsCreating(true)
            setShowSuccess(false)

            // 1. Generate NEW mint keypair
            const mintKeypair = Keypair.generate()
            console.log('🔑 New mint:', mintKeypair.publicKey.toString())

            // 2. Derive pool PDA
            const [poolPda] = PublicKey.findProgramAddressSync(
                [Buffer.from('pool'), mintKeypair.publicKey.toBuffer()],
                program.programId
            )
            console.log('🏊 Pool PDA:', poolPda.toString())

            // 3. Create mint account
            const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE)

            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: publicKey,
                newAccountPubkey: mintKeypair.publicKey,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
            })

            const initMintIx = createInitializeMintInstruction(
                mintKeypair.publicKey,
                6, // decimals
                publicKey, // mint authority (admin keeps control)
                null
            )

            const mintTx = new Transaction().add(createAccountIx, initMintIx)

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
            mintTx.recentBlockhash = blockhash
            mintTx.feePayer = publicKey
            mintTx.partialSign(mintKeypair)

            console.log('📤 Creating mint...')
            const mintSig = await sendTransaction(mintTx, connection)

            await connection.confirmTransaction({
                signature: mintSig,
                blockhash,
                lastValidBlockHeight,
            })

            console.log('✅ Mint created:', mintSig)

            // 4. Mint initial tokens to admin (for testing/initial liquidity)
            const adminAta = getAssociatedTokenAddressSync(mintKeypair.publicKey, publicKey)

            const createAtaIx = createAssociatedTokenAccountInstruction(
                publicKey,
                adminAta,
                publicKey,
                mintKeypair.publicKey
            )

            const mintAmount = 10_000_000_000_000 // 10 million tokens for admin
            const mintToIx = createMintToInstruction(
                mintKeypair.publicKey,
                adminAta,
                publicKey,
                mintAmount
            )

            const tokenTx = new Transaction().add(createAtaIx, mintToIx)
            const tokenSig = await sendTransaction(tokenTx, connection)

            await connection.confirmTransaction(tokenSig)
            console.log('✅ Tokens minted to admin:', tokenSig)

            // 5. Initialize the flash loan pool (ONLY ONCE)
            console.log('🚀 Initializing pool...')
            await initializePool.mutateAsync({
                authorityPubkey: publicKey,
                mintPubkey: mintKeypair.publicKey,
            })

            setCreatedMintAddress(mintKeypair.publicKey.toString())
            setCreatedPoolAddress(poolPda.toString())
            setShowSuccess(true)

            // alert(
            //     `✅ POOL CREATED!\n\n` +
            //     `Mint: ${mintKeypair.publicKey.toString()}\n\n` +
            //     `Pool: ${poolPda.toString()}\n\n` +
            //     `Share this mint address with users so they can deposit tokens and use the pool!`
            // )
        } catch (error) {
            console.error('❌ Error:', error)
            // alert(`Error: ${error.message}`)
        } finally {
            setIsCreating(false)
        }
    }

    if (!isAdmin) {
        return (
        <div className="card bg-base-200 shadow-xl p-5">
            <div className="card-body">
            <div className="alert alert-warning">
                <span>⚠️ Only the admin can initialize new pools.</span>
            </div>
            </div>
        </div>
        )
    }

    if (showSuccess) {
        return (
        <div className="card bg-base-200 shadow-xl p-5">
            <div className="card-body">
            <div className="alert alert-success">
                <svg
                xmlns="http://www.w3.org/2000/svg"
                className="stroke-current shrink-0 h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
                </svg>
                <div>
                <h3 className="font-bold">🎉 Pool Created!</h3>
                <p className="text-sm">Users can now deposit and use this pool.</p>
                </div>
            </div>

            <div className="space-y-3 mt-4">
                <div className="form-control">
                <label className="label">
                    <span className="label-text font-semibold">Mint Address (share with users)</span>
                </label>
                <input
                    type="text"
                    className="input input-bordered w-full text-xs"
                    value={createdMintAddress}
                    readOnly
                />
                </div>

                <div className="form-control">
                <label className="label">
                    <span className="label-text font-semibold">Pool Address</span>
                </label>
                <input
                    type="text"
                    className="input input-bordered w-full text-xs"
                    value={createdPoolAddress}
                    readOnly
                />
                </div>
            </div>

            <Button
                className="btn btn-primary mt-4"
                onClick={() => {
                setShowSuccess(false)
                setCreatedMintAddress('')
                setCreatedPoolAddress('')
                }}
            >
                Create Another Pool
            </Button>
            </div>
        </div>
        )
    }

    return (
        <div className="card bg-base-200 shadow-xl p-5">
        <div className="card-body">
            <h2 className="card-title text-3xl font-bold">Admin: Initialize New Pool</h2>
            <p className="text-sm text-base-content/70 mb-4">
            Create a new token mint and initialize a flash loan pool. This should only be done once per token.
            </p>

            <div className="alert alert-info">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="stroke-current shrink-0 w-6 h-6"
            >
                <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
            </svg>
            <div className="text-sm">
                <p className="font-bold">Admin Action:</p>
                <p>This creates a new pool that users can deposit into and borrow from.</p>
            </div>
            </div>

            <div className="card-actions flex justify-center mt-4">
            <Button
                className="btn btn-primary btn-lg"
                onClick={handleCreatePoolOnce}
                disabled={!publicKey || isCreating || initializePool.isPending}
            >
                {isCreating || initializePool.isPending ? (
                <>
                    <span className="loading loading-spinner"></span>
                    Creating Pool...
                </>
                ) : (
                '🚀 Create New Pool'
                )}
            </Button>
            </div>

            {isCreating && (
            <div className="mt-4">
                <progress className="progress progress-primary w-full"></progress>
            </div>
            )}
        </div>
        </div>
    )
}

// USER COMPONENT - Mint tokens to users (admin distributes tokens)
export function AdminMintTokens() {
    const { publicKey, sendTransaction } = useWallet()
    const { connection } = useConnection()
    const { loanPoolAccounts } = useFlashLoanProgram()
    const [selectedMint, setSelectedMint] = useState('')
    const [recipientAddress, setRecipientAddress] = useState('')
    const [amount, setAmount] = useState('')
    const [isMinting, setIsMinting] = useState(false)

    const isAdmin = publicKey?.toString() === "7EpJ8M9MBnN3Jyi7bwKhV9YFCzhDEK7drbMCTRB9Xm8Y"

    const handleMintTokens = async () => {
        if (!publicKey || !selectedMint || !recipientAddress || !amount) return

        try {
            setIsMinting(true)

            const mintPubkey = new PublicKey(selectedMint)
            const recipientPubkey = new PublicKey(recipientAddress)
            const mintAmount = parseFloat(amount) * 1e6

            // Get or create recipient's ATA
            const recipientAta = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey)

            // Check if ATA exists
            const ataInfo = await connection.getAccountInfo(recipientAta)
            const tx = new Transaction()

            if (!ataInfo) {
                const createAtaIx = createAssociatedTokenAccountInstruction(
                publicKey,
                recipientAta,
                recipientPubkey,
                mintPubkey
                )
                tx.add(createAtaIx)
            }

            const mintToIx = createMintToInstruction(mintPubkey, recipientAta, publicKey, mintAmount)
            tx.add(mintToIx)

            const sig = await sendTransaction(tx, connection)
            await connection.confirmTransaction(sig)

            alert(`✅ Minted ${amount} tokens to ${recipientAddress}`)
            setRecipientAddress('')
            setAmount('')
        } catch (error) {
            console.error('Error:', error)
            // alert(`Error: ${error.message}`)
        } finally {
            setIsMinting(false)
        }
    }

    if (!isAdmin) return null

    return (
        <div className="card bg-base-200 shadow-xl p-5">
        <div className="card-body">
            <h2 className="card-title text-2xl font-bold">Admin: Mint Tokens to Users</h2>

            <div className="form-control w-full">
            <label className="label">
                <span className="label-text">Select Pool/Mint</span>
            </label>
            <select
                className="select select-bordered w-full"
                value={selectedMint}
                onChange={(e) => setSelectedMint(e.target.value)}
            >
                <option value="">Choose a mint...</option>
                {loanPoolAccounts.data?.map((pool) => (
                <option key={pool.publicKey.toString()} value={pool.account.mint.toString()}>
                    {pool.account.mint.toString().slice(0, 8)}...
                </option>
                ))}
            </select>
            </div>

            <div className="form-control w-full">
            <label className="label">
                <span className="label-text">Recipient Address</span>
            </label>
            <input
                type="text"
                placeholder="User wallet address"
                className="input input-bordered w-full"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
            />
            </div>

            <div className="form-control w-full">
            <label className="label">
                <span className="label-text">Amount</span>
            </label>
            <input
                type="number"
                placeholder="0.00"
                className="input input-bordered w-full"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
            />
            </div>

            <Button
            className="btn btn-primary mt-4"
            onClick={handleMintTokens}
            disabled={!selectedMint || !recipientAddress || !amount || isMinting}
            >
            {isMinting ? 'Minting...' : 'Mint Tokens'}
            </Button>
        </div>
        </div>
    )
}

// POOLS LIST - Shows all existing pools
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
                <span>No pools found. Admin needs to create one!</span>
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

// POOL CARD - Users interact with existing pools
function FlashLoanCard({ account }: { account: PublicKey }) {
    const { accountQuery } = useFlashLoanProgramAccount({ account })
    const { publicKey } = useWallet()
    const { deposit, withdraw } = useFlashLoanProgram()

    const [depositAmount, setDepositAmount] = useState('')
    const [withdrawAmount, setWithdrawAmount] = useState('')
    const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit')

    const mintAddress = accountQuery.data?.mint.toString() || ''

    const handleDeposit = () => {
        if (!publicKey || !depositAmount) return

        try {
            const amount = new BN(parseFloat(depositAmount) * 1e6)
            const depositorAta = getAssociatedTokenAddressSync(new PublicKey(mintAddress), publicKey)

            deposit.mutateAsync({
                mintPubkey: new PublicKey(mintAddress),
                depositorAta,
                depositAmount: amount,
                depositorPubkey: publicKey,
            })
            setDepositAmount('')
        } catch (error) {
            console.error('Deposit error:', error)
            // alert(`Error: ${error.message}`)
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
            // alert(`Error: ${error.message}`)
        }
    }

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

                <div className="divider my-2"></div>

                <div className="text-xs text-base-content/70">
                    <p>Mint: {mintAddress.slice(0, 12)}...{mintAddress.slice(-12)}</p>
                </div>
            </div>
        </div>
    )
}

// MAIN FEATURE COMPONENT
export function FlashLoanFeature() {
    const { publicKey } = useWallet()
    const isAdmin = publicKey?.toString() === "7EpJ8M9MBnN3Jyi7bwKhV9YFCzhDEK7drbMCTRB9Xm8Y"

    return (
        <div className="space-y-8">
            <div className="text-center">
                <h1 className="text-4xl font-bold">Flash Loan Protocol</h1>
                <p className="text-lg text-base-content/70 mt-2">
                Deposit tokens and earn fees from flash loans
                </p>
                <div className="mt-4">
                    <WalletButton />
                </div>
            </div>

            {/* Admin Section */}
            {isAdmin && (
                <>
                    <div className="alert alert-info">
                        <span>👑 You are logged in as Admin</span>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <AdminInitializePool />
                        <AdminMintTokens />
                    </div>

                    <div className="divider"></div>
                </>
            )}

            {/* User Section - All Pools */}
            <div>
                <h2 className="text-2xl font-bold mb-4">Available Pools</h2>
                <p className="text-sm text-base-content/70 mb-4">
                Deposit tokens into these pools to earn 5% fees from flash loans
                </p>
                <FlashLoanList />
            </div>
        </div>
    )
}