from django.urls import include, path
from rest_framework.routers import DefaultRouter

from tables.views import TableViewSet

router = DefaultRouter()
router.register("tables", TableViewSet, basename="table")

urlpatterns = [path("", include(router.urls))]
