#![allow(clippy::result_large_err)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, 
    token::{Mint, Token, TokenAccount, Transfer, transfer}
};

use anchor_lang::{
    solana_program::sysvar::instructions::{
        get_instruction_relative, ID as INSTRUCTION_SYSVAR_ID,
    },
    Discriminator
};
declare_id!("J6jQqz6YhijRB3mkQvhDT28d2uYQK1vhf3p4E2ZcDgYo");
#[program]
pub mod flash_loan {
    use super::*;

    // Initialize a new loan pool for a specific token
    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.mint = ctx.accounts.mint.key();
        pool.total_deposited = 0;
        pool.total_borrowed = 0;
        pool.total_fees_collected = 0;
        pool.fee_basis_points = 500; // 5% fee
        pool.bump = ctx.bumps.pool;
        
        msg!("Pool initialized for mint: {}", pool.mint);
        Ok(())
    }

    // Deposit tokens into the pool
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ProtocolError::InvalidAmount);

        let pool = &mut ctx.accounts.pool;
        
        // Transfer tokens from depositor to pool
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_ata.to_account_info(),
            to: ctx.accounts.pool_ata.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer(cpi_ctx, amount)?;

        pool.total_deposited = pool.total_deposited
            .checked_add(amount)
            .ok_or(ProtocolError::Overflow)?;

        msg!("Deposited {} tokens. Total deposited: {}", amount, pool.total_deposited);
        Ok(())
    }

    // Withdraw tokens from the pool
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, ProtocolError::InvalidAmount);

        let pool = &mut ctx.accounts.pool;
        
        // Check available balance (deposited - currently borrowed)
        let available = pool.total_deposited
            .checked_sub(pool.total_borrowed)
            .ok_or(ProtocolError::NotEnoughFunds)?;
        
        require!(available >= amount, ProtocolError::NotEnoughFunds);

        // Transfer tokens from pool to withdrawer
        let seeds = &[
            b"pool",
            pool.mint.as_ref(),
            &[pool.bump]
        ];
        let signer_seeds = &[&seeds[..]];
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_ata.to_account_info(),
            to: ctx.accounts.withdrawer_ata.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        transfer(cpi_ctx, amount)?;

        pool.total_deposited = pool.total_deposited
            .checked_sub(amount)
            .ok_or(ProtocolError::Overflow)?;

        msg!("Withdrew {} tokens. Total deposited: {}", amount, pool.total_deposited);
        Ok(())
    }

    // Borrow tokens via flash loan
    pub fn borrow(ctx: Context<Loan>, borrow_amount: u64) -> Result<()> {
        require!(borrow_amount > 0, ProtocolError::InvalidAmount);

        let pool = &mut ctx.accounts.pool;
        
        // Check available balance
        let available = pool.total_deposited
            .checked_sub(pool.total_borrowed)
            .ok_or(ProtocolError::NotEnoughFunds)?;
        
        require!(available >= borrow_amount, ProtocolError::NotEnoughFunds);
        require!(
            ctx.accounts.pool_ata.amount >= borrow_amount,
            ProtocolError::NotEnoughFunds
        );

        // Update borrowed amount
        pool.total_borrowed = pool.total_borrowed
            .checked_add(borrow_amount)
            .ok_or(ProtocolError::Overflow)?;

        // Transfer tokens to borrower
        let seeds = &[
            b"pool",
            pool.mint.as_ref(),
            &[pool.bump]
        ];
        let signer_seeds = &[&seeds[..]];
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_ata.to_account_info(),
            to: ctx.accounts.borrower_ata.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        transfer(cpi_ctx, borrow_amount)?;

        let ixs = ctx.accounts.instructions.to_account_info();

        // Look for the repay instruction in the following instructions
        let mut found_repay = false;
        
        // Check next few instructions (typically repay would be immediately after)
        for offset in 1..=10 {
            match get_instruction_relative(offset, &ixs) {
                Ok(repay_ix) => {
                    msg!("Checking instruction at relative offset {}", offset);
                    msg!("Program Id: {}", repay_ix.program_id);

                    // Check if this is our program and repay instruction
                    if repay_ix.program_id == crate::ID 
                        && repay_ix.data.len() >= 8 
                        && repay_ix.data[0..8] == *instruction::Repay::DISCRIMINATOR
                    {
                        msg!("Found repay instruction at relative offset {}", offset);

                        // Verify the accounts match
                        require!(
                            repay_ix.accounts.len() >= 6,
                            ProtocolError::InvalidIx
                        );

                        // Check pool account (index 1 in the accounts)
                        let repay_pool = repay_ix
                            .accounts
                            .get(1)
                            .ok_or(ProtocolError::InvalidPool)?;
                        require_keys_eq!(
                            repay_pool.pubkey, 
                            pool.key(), 
                            ProtocolError::InvalidPool
                        );

                        // Check borrower ata (index 3)
                        let repay_borrower_ata = repay_ix
                            .accounts
                            .get(3)
                            .ok_or(ProtocolError::InvalidBorrowerAta)?;
                        require_keys_eq!(
                            repay_borrower_ata.pubkey, 
                            ctx.accounts.borrower_ata.key(), 
                            ProtocolError::InvalidBorrowerAta
                        );

                        // Check pool ata (index 4)
                        let repay_pool_ata = repay_ix
                            .accounts
                            .get(4)
                            .ok_or(ProtocolError::InvalidPoolAta)?;
                        require_keys_eq!(
                            repay_pool_ata.pubkey, 
                            ctx.accounts.pool_ata.key(), 
                            ProtocolError::InvalidPoolAta
                        );

                        found_repay = true;
                        break;
                    }
                }
                Err(_) => {
                    // No more instructions to check
                    break;
                }
            }
        }

        require!(found_repay, ProtocolError::MissingRepayIx);
        
        msg!("Borrowed {} tokens. Total borrowed: {}", borrow_amount, pool.total_borrowed);
        Ok(())
    }

    // Repay the flash loan
    pub fn repay(ctx: Context<Loan>) -> Result<()> {
        let ixs = ctx.accounts.instructions.to_account_info();
        
        // Find the borrow instruction (should be before current repay)
        let mut amount_borrowed: Option<u64> = None;
        
        // Check previous instructions for the borrow call
        for offset in 1..=10 {
            match get_instruction_relative(-(offset as i64), &ixs) {
                Ok(borrow_ix) => {
                    if borrow_ix.program_id == crate::ID 
                        && borrow_ix.data.len() >= 16 
                        && borrow_ix.data[0..8] == *instruction::Borrow::DISCRIMINATOR 
                    {
                        let mut borrowed_data: [u8; 8] = [0u8; 8];
                        borrowed_data.copy_from_slice(&borrow_ix.data[8..16]);
                        amount_borrowed = Some(u64::from_le_bytes(borrowed_data));
                        msg!("Found borrow instruction with amount: {}", amount_borrowed.unwrap());
                        break;
                    }
                }
                Err(_) => {
                    // No more instructions to check
                    break;
                }
            }
        }

        let amount_borrowed = amount_borrowed.ok_or(ProtocolError::MissingBorrowIx)?;

        let pool = &mut ctx.accounts.pool;

        // Calculate fee
        let fee = (amount_borrowed as u128)
            .checked_mul(pool.fee_basis_points as u128)
            .ok_or(ProtocolError::Overflow)?
            .checked_div(10_000)
            .ok_or(ProtocolError::Overflow)? as u64;
        
        let repay_amount = amount_borrowed
            .checked_add(fee)
            .ok_or(ProtocolError::Overflow)?;

        msg!("Repaying {} (borrowed: {}, fee: {})", repay_amount, amount_borrowed, fee);

        // Verify borrower has enough funds
        require!(
            ctx.accounts.borrower_ata.amount >= repay_amount,
            ProtocolError::NotEnoughFunds
        );

        // Transfer tokens back to pool
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.accounts.borrower_ata.to_account_info(),
            to: ctx.accounts.pool_ata.to_account_info(),
            authority: ctx.accounts.borrower.to_account_info()
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer(cpi_ctx, repay_amount)?;

        // Update pool state
        pool.total_borrowed = pool.total_borrowed
            .checked_sub(amount_borrowed)
            .ok_or(ProtocolError::Overflow)?;
        
        pool.total_fees_collected = pool.total_fees_collected
            .checked_add(fee)
            .ok_or(ProtocolError::Overflow)?;

        msg!("Repaid successfully. Total fees collected: {}", pool.total_fees_collected);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + LoanPool::INIT_SPACE,
        seeds = [b"pool", mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, LoanPool>,

    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = pool,
    )]
    pub pool_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", mint.key().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, LoanPool>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = depositor,
    )]
    pub depositor_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
    )]
    pub pool_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub withdrawer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", mint.key().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, LoanPool>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = withdrawer,
    )]
    pub withdrawer_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
    )]
    pub pool_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Loan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", mint.key().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, LoanPool>,

    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = mint,
        associated_token::authority = borrower,
    )]
    pub borrower_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
    )]
    pub pool_ata: Account<'info, TokenAccount>,

    #[account(address = INSTRUCTION_SYSVAR_ID)]
    /// CHECK: InstructionsSysvar account
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[account]
#[derive(InitSpace)]
pub struct LoanPool {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub total_deposited: u64,
    pub total_borrowed: u64,
    pub total_fees_collected: u64,
    pub fee_basis_points: u16,
    pub bump: u8,
}

#[error_code]
pub enum ProtocolError {
    #[msg("Invalid Amount")]
    InvalidAmount,
    #[msg("Invalid instruction")]
    InvalidIx,
    #[msg("Invalid instruction index")]
    InvalidInstructionIndex,
    #[msg("Not enough funds")]
    NotEnoughFunds,
    #[msg("Program Mismatch")]
    ProgramMismatch,
    #[msg("Invalid Program")]
    InvalidProgram,
    #[msg("Invalid borrower ata")]
    InvalidBorrowerAta,
    #[msg("Invalid pool")]
    InvalidPool,
    #[msg("Invalid pool ata")]
    InvalidPoolAta,
    #[msg("Missing repay instruction")]
    MissingRepayIx,
    #[msg("Missing borrow instruction")]
    MissingBorrowIx,
    #[msg("Overflow")]
    Overflow,
}