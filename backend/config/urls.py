from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("organizations.urls")),
    path("api/", include("catalog.urls")),
    path("api/", include("tables.urls")),
    path("api/", include("orders.urls")),
    path("api/", include("billing.urls")),
    path("api/", include("hotel.urls")),
    path("api/", include("customers.urls")),
    path("api/", include("reports.urls")),
]

if settings.DEBUG:
    # Production serves /media via nginx (see nginx/nginx.conf) — this is
    # dev-only, mirroring Django's own runserver-static-files pattern.
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
