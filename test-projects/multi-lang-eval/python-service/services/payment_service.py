from typing import Dict, Any
from ..models.user import User

class PaymentProcessor:
    def __init__(self, gateway_url: str):
        self.gateway_url = gateway_url

    async def charge_user(self, user: User, amount: float, currency: str = "USD") -> Dict[str, Any]:
        if amount <= 0:
            raise ValueError("Amount must be positive")
        
        tx_id = f"tx_{user.id}_{int(amount*100)}"
        return {
            "transaction_id": tx_id,
            "status": "success",
            "amount": amount,
            "currency": currency,
            "user_email": user.email
        }
