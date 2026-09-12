from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def broadcast_ticket_update(store_id, ticket):
    """Called synchronously from the orders API (PATCH item status) to push
    the updated ticket to every KDS screen watching this store."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        f"kds_{store_id}",
        {
            "type": "ticket_update",
            "payload": {
                "ticket_id": str(ticket.id),
                "order_id": str(ticket.order_id),
                "kitchen_station": ticket.kitchen_station,
                "status": ticket.status,
            },
        },
    )
