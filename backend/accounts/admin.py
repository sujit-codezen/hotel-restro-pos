from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from accounts.models import Role, StoreStaff, User


class UserAdmin(DjangoUserAdmin):
    ordering = ["email"]
    list_display = ["email", "first_name", "last_name", "organization", "is_staff"]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name", "phone", "organization")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active", "is_staff", "is_superuser", "groups", "user_permissions",
                )
            },
        ),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )
    search_fields = ["email"]


admin.site.register(User, UserAdmin)
admin.site.register(StoreStaff)
admin.site.register(Role)
