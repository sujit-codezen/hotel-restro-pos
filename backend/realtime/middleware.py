from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def _get_user_from_token(token):
    from accounts.models import User

    try:
        validated = AccessToken(token)
        return User.objects.get(id=validated["user_id"])
    except (InvalidToken, User.DoesNotExist, KeyError):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """Channels has no built-in DRF/SimpleJWT auth, so WS clients pass the
    access token as ?token=... on the connection URL and this middleware
    resolves scope['user'] from it, mirroring JWTAuthentication for HTTP."""

    async def __call__(self, scope, receive, send):
        query_string = parse_qs(scope["query_string"].decode())
        token = query_string.get("token", [None])[0]
        scope["user"] = (
            await _get_user_from_token(token) if token else AnonymousUser()
        )
        return await super().__call__(scope, receive, send)
