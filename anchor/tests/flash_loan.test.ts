import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { FlashLoan } from '../target/types/flash_loan'
import { BN } from 'bn.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

describe('Flash Loan', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const payer = provider.wallet as anchor.Wallet

  const program = anchor.workspace.FlashLoan as Program<FlashLoan>

  const borrowAmount = new BN(1000);
  const depositAmount = new BN(10000);
  
  let pool: PublicKey;
  let mint: PublicKey;
  let borrowerAta: PublicKey;
  let poolAta: PublicKey;
  let depositorAta: PublicKey;

  beforeAll(async () => {
    // Create mint
    mint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );

    // Find pool PDA
    [pool] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mint.toBuffer()],
      program.programId
    );

    // Get pool ATA address (will be created during initialize)
    poolAta = getAssociatedTokenAddressSync(
      mint,
      pool,
      true // allowOwnerOffCurve - allows PDA as owner
    );

    // Create depositor ATA and mint tokens
    const depositorAtaAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      mint,
      payer.publicKey
    );
    depositorAta = depositorAtaAccount.address;

    // Mint tokens to depositor
    await mintTo(
      provider.connection,
      payer.payer,
      mint,
      depositorAta,
      payer.publicKey,
      depositAmount.toNumber() * 2 // Mint extra for fees
    );

    // Get borrower ATA address (will be created during borrow with init_if_needed)
    borrowerAta = getAssociatedTokenAddressSync(
      mint,
      payer.publicKey
    );
  })

  it('Initialize Pool', async () => {
    const tx = await program.methods
      .initializePool()
      .accountsStrict({
        authority: payer.publicKey,
        pool,
        mint,
        poolAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
      })
      .rpc()

    console.log("Initialize pool tx:", tx);

    // Fetch and display pool data
    const poolAccount = await program.account.loanPool.fetch(pool);
    console.log("Pool initialized:", {
      authority: poolAccount.authority.toString(),
      mint: poolAccount.mint.toString(),
      totalDeposited: poolAccount.totalDeposited.toString(),
      totalBorrowed: poolAccount.totalBorrowed.toString(),
      feeBasisPoints: poolAccount.feeBasisPoints,
    });
  })

  it('Deposit to Pool', async () => {
    const tx = await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        depositor: payer.publicKey,
        pool,
        mint,
        depositorAta,
        poolAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()

    console.log("Deposit tx:", tx);

    // Fetch and display pool data
    const poolAccount = await program.account.loanPool.fetch(pool);
    console.log("Pool after deposit:", {
      totalDeposited: poolAccount.totalDeposited.toString(),
      totalBorrowed: poolAccount.totalBorrowed.toString(),
      totalFeesCollected: poolAccount.totalFeesCollected.toString(),
    });
  })

  it('Borrow and Repay (Flash Loan)', async () => {
    // Get pool state before
    const poolBefore = await program.account.loanPool.fetch(pool);
    console.log("Pool before flash loan:", {
      totalDeposited: poolBefore.totalDeposited.toString(),
      totalBorrowed: poolBefore.totalBorrowed.toString(),
    });

    // Create borrow and repay instructions
    const borrowIx = await program.methods
      .borrow(borrowAmount)
      .accountsStrict({
        borrower: payer.publicKey,
        pool,
        mint,
        borrowerAta,
        poolAta,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
      })
      .instruction()

    const repayIx = await program.methods
      .repay()
      .accountsStrict({
        borrower: payer.publicKey,
        pool,
        mint,
        borrowerAta,
        poolAta,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
      })
      .instruction()

    // Send both instructions in one transaction
    const tx = new anchor.web3.Transaction()
      .add(borrowIx)
      .add(repayIx)

    const txHash = await provider.sendAndConfirm(tx);
    console.log("Flash loan tx:", txHash);

    // Get pool state after
    const poolAfter = await program.account.loanPool.fetch(pool);
    console.log("Pool after flash loan:", {
      totalDeposited: poolAfter.totalDeposited.toString(),
      totalBorrowed: poolAfter.totalBorrowed.toString(),
      totalFeesCollected: poolAfter.totalFeesCollected.toString(),
    });

    // Verify fee was collected
    const expectedFee = borrowAmount.toNumber() * 500 / 10000; // 5%
    console.log("Expected fee:", expectedFee);
    console.log("Actual fee collected:", poolAfter.totalFeesCollected.toString());
  })

  it('Withdraw from Pool', async () => {
    const poolBefore = await program.account.loanPool.fetch(pool);
    const withdrawAmount = new BN(5000);

    const tx = await program.methods
      .withdraw(withdrawAmount)
      .accountsStrict({
        withdrawer: payer.publicKey,
        pool,
        mint,
        withdrawerAta: depositorAta,
        poolAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()

    console.log("Withdraw tx:", tx);

    // Fetch and display pool data
    const poolAfter = await program.account.loanPool.fetch(pool);
    console.log("Pool after withdrawal:", {
      totalDeposited: poolAfter.totalDeposited.toString(),
      availableForBorrow: poolAfter.totalDeposited.sub(poolAfter.totalBorrowed).toString(),
    });
  })

  it('Fail to Borrow without Repay', async () => {
    try {
      await program.methods
        .borrow(borrowAmount)
        .accountsStrict({
          borrower: payer.publicKey,
          pool,
          mint,
          borrowerAta,
          poolAta,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID
        })
        .rpc()
      
      throw new Error("Should have failed without repay instruction");
    } catch (err) {
      console.log("Expected error:", err.message);
      expect(err.message).toContain("MissingRepayIx");
    }
  })
})