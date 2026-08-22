pub struct Hasher {
    salt: String,
}

impl Hasher {
    pub fn new(salt: &str) -> Self {
        Self {
            salt: salt.to_string(),
        }
    }

    pub fn hash_payload(&self, payload: &str) -> String {
        format!("{}_{}", self.salt, payload.len())
    }
}
