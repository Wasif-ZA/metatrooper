from .core import get_usr


def render_user(user_id: int) -> str:
    user = get_usr(user_id)
    return f"User #{user['id']}: {user['name']}"
