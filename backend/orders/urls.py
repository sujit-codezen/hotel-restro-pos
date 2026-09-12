from django.urls import include, path
from rest_framework.routers import DefaultRouter

from orders.views import KitchenTicketViewSet, OrderViewSet

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")
router.register("kitchen-tickets", KitchenTicketViewSet, basename="kitchen-ticket")

urlpatterns = [path("", include(router.urls))]
