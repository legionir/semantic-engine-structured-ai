pub enum TokenType {
    Identifier,
    Keyword,
    Literal,
    Punctuation,
}

pub struct Token {
    pub kind: TokenType,
    pub value: String,
    pub line: usize,
}

pub trait Tokenizer {
    fn tokenize(&self, input: &str) -> Vec<Token>;
}

pub struct Parser {
    capacity: usize,
}

impl Parser {
    pub fn new(capacity: usize) -> Self {
        Self { capacity }
    }

    pub fn parse(&self, source: &str) -> Vec<Token> {
        let mut tokens = Vec::new();
        for (i, word) in source.split_whitespace().enumerate() {
            tokens.push(Token {
                kind: TokenType::Identifier,
                value: word.to_string(),
                line: i + 1,
            });
        }
        tokens
    }
}
