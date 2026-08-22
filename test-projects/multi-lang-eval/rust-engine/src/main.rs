mod parser;
mod security;

use parser::{Parser, Token};
use security::Hasher;

pub struct EngineConfig {
    pub max_tokens: usize,
    pub strict_mode: bool,
}

impl EngineConfig {
    pub fn default() -> Self {
        Self {
            max_tokens: 1000,
            strict_mode: true,
        }
    }
}

fn main() {
    let config = EngineConfig::default();
    let parser = Parser::new(config.max_tokens);
    let hasher = Hasher::new("salt_v1");

    let tokens = parser.parse("let x = 42;");
    let hash = hasher.hash_payload("let x = 42;");

    println!("Parsed {} tokens, hash: {}", tokens.len(), hash);
}
