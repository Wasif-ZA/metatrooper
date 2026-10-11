from .core import get_usr


def fetch_profile(user_id: int) -> str:
    user = get_usr(user_id)
    return user["name"]
