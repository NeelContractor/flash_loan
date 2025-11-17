// Here we export some useful types and functions for interacting with the Anchor program.
import { AnchorProvider, Program } from '@coral-xyz/anchor'
import { Cluster, PublicKey } from '@solana/web3.js'
import FlashLoanIDL from '../target/idl/flash_loan.json'
import type { FlashLoan } from '../target/types/flash_loan'

// Re-export the generated IDL and type
export { FlashLoan, FlashLoanIDL }

// The programId is imported from the program IDL.
export const FLASH_LOAN_PROGRAM_ID = new PublicKey(FlashLoanIDL.address)

// This is a helper function to get the Counter Anchor program.
export function getFlashLoanProgram(provider: AnchorProvider, address?: PublicKey): Program<FlashLoan> {
  return new Program({ ...FlashLoanIDL, address: address ? address.toBase58() : FlashLoanIDL.address } as FlashLoan, provider)
}

// This is a helper function to get the program ID for the Counter program depending on the cluster.
export function getFlashLoanProgramId(cluster: Cluster) {
  switch (cluster) {
    case 'devnet':
    case 'testnet':
      // This is the program ID for the Counter program on devnet and testnet.
      return new PublicKey('J6jQqz6YhijRB3mkQvhDT28d2uYQK1vhf3p4E2ZcDgYo')
    case 'mainnet-beta':
    default:
      return FLASH_LOAN_PROGRAM_ID
  }
}
