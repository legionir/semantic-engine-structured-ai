from dataclasses import dataclass
from typing import Optional, List
from datetime import datetime

@dataclass
class User:
    id: str
    username: str
    email: str
    is_active: bool = True
    created_at: Optional[datetime] = None

    def display_name(self) -> str:
        return f"{self.username} <{self.email}>"

    def deactivate(self) -> None:
        self.is_active = False
