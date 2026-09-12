from django.urls import re_path

from realtime.consumers import KDSConsumer

websocket_urlpatterns = [
    re_path(r"^ws/kds/(?P<store_id>[0-9a-f-]+)/$", KDSConsumer.as_asgi()),
]
