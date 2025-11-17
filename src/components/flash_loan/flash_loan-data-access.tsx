'use client'

import { getFlashLoanProgram, getFlashLoanProgramId } from '@project/anchor'
import { useConnection } from '@solana/wallet-adapter-react'
import { Cluster, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useCluster } from '../cluster/cluster-data-access'
import { useAnchorProvider } from '../solana/solana-provider'
import { useTransactionToast } from '../use-transaction-toast'
import { toast } from 'sonner'
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import BN from 'bn.js'

interface InitializePoolArgs {
  mintPubkey: PublicKey, 
  authorityPubkey: PublicKey
}

interface DepositArgs {
  mintPubkey: PublicKey, 
  depositorAta: PublicKey, 
  depositAmount: BN, 
  depositorPubkey: PublicKey
}

interface RepayArgs {
  mintPubkey: PublicKey, 
  borrowerPubkey: PublicKey
}

interface WithdrawArgs {
  mintPubkey: PublicKey, 
  withdrawerPubkey: PublicKey, 
  withdrawAmount: BN
}

export function useFlashLoanProgram() {
  const { connection } = useConnection()
  const { cluster } = useCluster()
  const transactionToast = useTransactionToast()
  const provider = useAnchorProvider()
  const programId = useMemo(() => getFlashLoanProgramId(cluster.network as Cluster), [cluster])
  const program = useMemo(() => getFlashLoanProgram(provider, programId), [provider, programId])

  const loanPoolAccounts = useQuery({
    queryKey: ['loanPool', 'all', { cluster }],
    queryFn: () => program.account.loanPool.all(),
  })

  const getProgramAccount = useQuery({
    queryKey: ['get-program-account', { cluster }],
    queryFn: () => connection.getParsedAccountInfo(programId),
  })

  const initializePool = useMutation<string, Error, InitializePoolArgs>({
    mutationKey: ['pool', 'initialize', { cluster }],
    mutationFn: async ({ mintPubkey, authorityPubkey }) => {
      const [pool] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool'), mintPubkey.toBuffer()],
        program.programId
      )

      const poolAta = getAssociatedTokenAddressSync(mintPubkey, pool, true)

      return await program.methods
        .initializePool()
        .accountsStrict({
          authority: authorityPubkey,
          pool,
          mint: mintPubkey,
          poolAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc()
    },
    onSuccess: async (signature) => {
      transactionToast(signature)
      await loanPoolAccounts.refetch()
    },
    onError: (error) => {
      toast.error(`Failed to initialize pool: ${error.message}`)
    },
  })

  const deposit = useMutation<string, Error, DepositArgs>({
    mutationKey: ['amount', 'deposit', { cluster }],
    mutationFn: async ({ mintPubkey, depositorAta, depositAmount, depositorPubkey }) => {
      const [pool] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool'), mintPubkey.toBuffer()],
        program.programId
      )
      const poolAta = getAssociatedTokenAddressSync(mintPubkey, pool, true)

      return await program.methods
        .deposit(depositAmount)
        .accountsStrict({
          depositor: depositorPubkey,
          pool,
          mint: mintPubkey,
          depositorAta,
          poolAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()
    },
    onSuccess: async (signature) => {
      transactionToast(signature)
      await loanPoolAccounts.refetch()
    },
    onError: (error) => {
      toast.error(`Failed to deposit: ${error.message}`)
    },
  })

  const repay = useMutation<string, Error, RepayArgs>({
    mutationKey: ['amount', 'repay', { cluster }],
    mutationFn: async({ mintPubkey, borrowerPubkey }) => {
      const [pool] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), mintPubkey.toBuffer()],
        program.programId
      );

      const poolAta = getAssociatedTokenAddressSync(
        mintPubkey,
        pool,
      );

      const borrowerAta = getAssociatedTokenAddressSync(
        mintPubkey,
        borrowerPubkey
      );

      return await program.methods
        .repay()
        .accountsStrict({ 
          borrower: borrowerPubkey,
          pool,
          mint: mintPubkey,
          borrowerAta,
          poolAta,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
        })
        .rpc()
      },
    onSuccess: async (signature) => {
      transactionToast(signature)
      await loanPoolAccounts.refetch()
    },
    onError: () => {
      toast.error('Failed to repay')
    },
  })

  const withdraw = useMutation<string, Error, WithdrawArgs>({
    mutationKey: ['amount', 'withdraw', { cluster }],
    mutationFn: async ({ mintPubkey, withdrawerPubkey, withdrawAmount }) => {
      const [pool] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool'), mintPubkey.toBuffer()],
        program.programId
      )

      const poolAta = getAssociatedTokenAddressSync(mintPubkey, pool, true)
      const withdrawerAta = getAssociatedTokenAddressSync(mintPubkey, withdrawerPubkey)

      return await program.methods
        .withdraw(withdrawAmount)
        .accountsStrict({
          withdrawer: withdrawerPubkey,
          pool,
          mint: mintPubkey,
          withdrawerAta,
          poolAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()
    },
    onSuccess: async (signature) => {
      transactionToast(signature)
      await loanPoolAccounts.refetch()
    },
    onError: (error) => {
      toast.error(`Failed to withdraw: ${error.message}`)
    },
  })

  return {
    program,
    programId,
    loanPoolAccounts,
    getProgramAccount,
    initializePool,
    deposit,
    repay,
    withdraw,
  }
}

export function useFlashLoanProgramAccount({ account }: { account: PublicKey }) {
  const { cluster } = useCluster()
  const transactionToast = useTransactionToast()
  const { program, loanPoolAccounts } = useFlashLoanProgram()

  const accountQuery = useQuery({
    queryKey: ['loanPool', 'fetch', { cluster, account: account.toString() }],
    queryFn: () => program.account.loanPool.fetch(account),
  })

  return {
    accountQuery,
  }
}
