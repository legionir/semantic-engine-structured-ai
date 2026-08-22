import time
import hashlib
from typing import Dict, Any, Optional

class TokenError(Exception):
    pass

class JwtHandler:
    def __init__(self, secret: str, ttl_seconds: int = 3600):
        self._secret = secret
        self._ttl = ttl_seconds

    def generate_token(self, user_id: str, claims: Optional[Dict[str, Any]] = None) -> str:
        payload = {
            "sub": user_id,
            "exp": time.time() + self._ttl,
            "claims": claims or {}
        }
        signature = hashlib.sha256(f"{user_id}:{self._secret}".encode()).hexdigest()
        return f"tok.{user_id}.{signature}"

    def verify_token(self, token: str) -> Dict[str, Any]:
        parts = token.split(".")
        if len(parts) != 3 or parts[0] != "tok":
            raise TokenError("Malformed token structure")
        return {"sub": parts[1], "valid": True}
