from django.urls import include, path
from rest_framework.routers import DefaultRouter

from catalog.views import (
    MenuCategoryViewSet,
    MenuItemViewSet,
    ModifierGroupViewSet,
    ModifierViewSet,
    TaxClassViewSet,
)

router = DefaultRouter()
router.register("menu-categories", MenuCategoryViewSet, basename="menu-category")
router.register("menu-items", MenuItemViewSet, basename="menu-item")
router.register("modifier-groups", ModifierGroupViewSet, basename="modifier-group")
router.register("modifiers", ModifierViewSet, basename="modifier")
router.register("tax-classes", TaxClassViewSet, basename="tax-class")

urlpatterns = [path("", include(router.urls))]
