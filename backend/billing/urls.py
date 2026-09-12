from django.urls import include, path
from rest_framework.routers import DefaultRouter

from billing.views import DiscountViewSet, InvoiceViewSet

router = DefaultRouter()
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("discounts", DiscountViewSet, basename="discount")

urlpatterns = [path("", include(router.urls))]
