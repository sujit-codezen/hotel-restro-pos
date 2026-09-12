from django.urls import include, path
from rest_framework.routers import DefaultRouter

from organizations.views import OnboardingView, OrganizationView, StoreViewSet

router = DefaultRouter()
router.register("stores", StoreViewSet, basename="store")

urlpatterns = [
    path("org/onboarding/", OnboardingView.as_view(), name="onboarding"),
    path("org/", OrganizationView.as_view(), name="organization"),
    path("", include(router.urls)),
]
