from django.urls import include, path
from rest_framework.routers import DefaultRouter

from hotel.views import (
    FolioViewSet,
    GuestStayViewSet,
    ReservationViewSet,
    RoomTypeViewSet,
    RoomViewSet,
)

router = DefaultRouter()
router.register("room-types", RoomTypeViewSet, basename="room-type")
router.register("rooms", RoomViewSet, basename="room")
router.register("reservations", ReservationViewSet, basename="reservation")
router.register("guest-stays", GuestStayViewSet, basename="guest-stay")
router.register("folios", FolioViewSet, basename="folio")

urlpatterns = [path("", include(router.urls))]
