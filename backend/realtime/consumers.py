import json

from channels.exceptions import DenyConnection
from channels.generic.websocket import AsyncJsonWebsocketConsumer


class KDSConsumer(AsyncJsonWebsocketConsumer):
    """One group per store: kds_<store_id>. Kitchen ticket/item status
    changes are pushed here by realtime.services.broadcast_ticket_update()
    (called from the orders API when an item's status changes)."""

    async def connect(self):
        self.store_id = self.scope["url_route"]["kwargs"]["store_id"]
        user = self.scope["user"]
        if not user.is_authenticated:
            raise DenyConnection("Authentication required")
        # Trusts store_id matches the user's organization; a stricter check
        # (user has a StoreStaff row for this exact store) belongs here
        # before this consumer handles real traffic.
        self.group_name = f"kds_{self.store_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def ticket_update(self, event):
        await self.send_json(event["payload"])
