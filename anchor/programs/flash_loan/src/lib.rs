#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, 
    token::{Mint, Token, TokenAccount, Transfer, transfer}
};

use anchor_lang::{
    solana_program::sysvar::instructions::{
        load_instruction_at_checked, ID as INSTRUCTION_SYSVAR_ID,
    },
    Discriminator
};
declare_id!("FqzkXZdwYjurnUKetJCAvaUw5WAqbwzU6gZEwydeEfqS");

#[program]
pub mod flash_loan {
    use super::*;

    pub fn borrow(ctx: Context<Loan>, borrow_amount: u64) -> Result<()> {
        require!(borrow_amount > 0, ProtocolError::InvalidAmount);

        let seeds = &[
            b"protocol".as_ref(),
            &[ctx.bumps.protocol]
        ];
        let signer_seeds = &[&seeds[..]];
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.accounts.protocol_ata.to_account_info(),
            to: ctx.accounts.borrower_ata.to_account_info(),
            authority: ctx.accounts.protocol.to_account_info(),
        };
        let ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        transfer(ctx, borrow_amount)?;

        let ixs = ctx.accounts.instructions.to_account_info();

        //check how many instructions we have in this transaction
        let instruction_sysvar: std::cell::Ref<'_, &mut [u8]> = ixs.try_borrow_data()?;
        let len = u16::from_le_bytes(instruction_sysvar[0..2].try_into().unwrap());

        msg!("Total instructions in transaction: {}",len);

        let mut found_repay = false;

        //check the next instruction (current index + 1)
        // Instructions are 0-indexed, so of this is instruction N, repay should be N+1
        for i in 1..len {
            if let Ok(repay_ix) =load_instruction_at_checked(i as usize, &ixs) {
                msg!("Checking instruction at index {}", i);
                msg!("Program Id: {}", repay_ix.program_id);

                //check if this is our program and repay instruction
                if repay_ix.program_id == ID && repay_ix.data.len() >= 8 && repay_ix.data[0..8].eq(instruction::Repay::DISCRIMINATOR) {
                    msg!("Found repay instruction at index {}", i);

                    //verify the accounts match
                    if repay_ix.accounts.len() >= 5 {
                        //check borrower ata
                        let repay_borrower_ata = repay_ix
                            .accounts
                            .get(3)
                            .ok_or(ProtocolError::InvalidBorrowerAta)?;
                        require_keys_eq!(repay_borrower_ata.pubkey, ctx.accounts.borrower_ata.key(), ProtocolError::InvalidBorrowerAta);

                        //check protocol ata
                        let repay_protocol_ata = repay_ix
                            .accounts
                            .get(4)
                            .ok_or(ProtocolError::InvalidProtocolAta)?;
                        require_keys_eq!(repay_protocol_ata.pubkey, ctx.accounts.protocol_ata.key(), ProtocolError::invalidProtocolAta);

                        found_repay = true;
                        break;
                    } else {
                        msg!("Repay instruction has insufficient accounts: {}", repay_ix.accounts.len());
                    }
                }
            }
        }

        require!(found_repay, ProtocolError::MissingRepayIx);
        Ok(())
    }

    pub fn repay(ctx: Context<Loan>) -> Result<()> {
        let ixs = ctx.accounts.instructions.to_account_info();

        let mut amount_borrowed: u64;

        if let Ok(borrow_ix) = load_instruction_at_checked(0, &ixs) {
            //Check the amount borrowed
            let mut borrowed_data: [u8; 8] = [0u8; 8];
            borrowed_data.copy_from_slice(&borrow_ix.data[8..16]);
            amount_borrowed = u64::from_le_bytes(borrowed_data)
        } else {
            return Err(ProtocolError::MissingBorrowIx.into());
        }

        //add the fee to the amount borrowed - 500 basis point
        let fee = (amount_borrowed as u128).checked_mul(500).unwrap().checked_div(10_000).ok_or(ProtocolError::Overflow)? as u64;
        amount_borrowed = amount_borrowed.checked_add(fee).ok_or(ProtocolError::Overflow)?;

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: ctx.accounts.borrower_ata.to_account_info(),
            to: ctx.accounts.protocol_ata.to_account_info(),
            authority: ctx.accounts.borrower.to_account_info()
        };
        let ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer(ctx, amount_borrowed)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Loan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        seeds = [b"protocol".as_ref()],
        bump
    )]
    pub protocol: SystemAccount<'info>,

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
        associated_token::authority = protocol,
    )]
    pub protocol_ata: Account<'info, TokenAccount>,

    #[account(address = INSTRUCTION_SYSVAR_ID)]
    ///CHECK: InstructionsSysvar account
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[error_code]
pub enum ProtocolError {
    #[msg("Invalid Amount")]
    InvalidAmount,
    #[msg("Invalid instruction")]
    InvalidIx,
    #[msg("Invalid instruction index")]
    InvalidinstructionIndex,
    #[msg("Not enough funds")]
    NotEnoughFunds,
    #[msg("Program Mismatch")]
    ProgramMismatch,
    #[msg("invalid Program")]
    InvalidProgram,
    #[msg("invalid borrower ata")]
    InvalidBorrowerAta,
    #[msg("invalid protocol ata")]
    InvalidProtocolAta,
    #[msg("Missing repay instruction")]
    MissingRepayIx,
    #[msg("Missing borrow instruction")]
    MissingBorrowIx,
    #[msg("Overflow")]
    Overflow,
}