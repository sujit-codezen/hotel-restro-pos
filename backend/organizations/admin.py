from django.contrib import admin

from organizations.models import Organization, Store

admin.site.register(Organization)
admin.site.register(Store)
