//! Qt migration domain: candidate scanning, Qt generation detection, the
//! Session-level intake state machine, question-card templates, and
//! version-strategy decisions. Pure logic; wire serde DTOs live in
//! `bitfun_product_domains`.

pub mod admission;
pub mod detect;
pub mod instructions;
pub mod layout;
pub mod output;
pub mod question_card;
pub mod scan;
pub mod semantic;
pub mod skill_receipt;
pub mod state;
pub mod strategy;
pub mod templates;

#[cfg(test)]
mod tests;
