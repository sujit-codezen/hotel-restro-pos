import uuid

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.db import models

from core.models import BaseTenantModel, TimeStampedModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """Email-login user. `organization` is null for platform staff
    (Django admin superusers who aren't tied to a single tenant)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None
    email = models.EmailField(unique=True)
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="users",
    )
    phone = models.CharField(max_length=32, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email


class Role(BaseTenantModel):
    """DB-driven, per-organization role — replaces the old fixed
    StoreStaff.Role enum. Permission flags are a deliberately bounded set
    covering the sensitive actions actually gated in the API (see
    core.permissions.require_permission); this is not an exhaustive
    per-module CRUD matrix, since nothing enforces flags beyond these.
    `is_system` marks the roles seeded at onboarding (Owner, Admin,
    Manager, Cashier, Waiter, Kitchen, Front Desk) — editable like any
    other role, but organizations.OnboardingSerializer always creates a
    fresh set of these so an org can't be left with zero usable roles."""

    name = models.CharField(max_length=80)
    is_system = models.BooleanField(default=False)

    can_refund_or_void = models.BooleanField(default=False)
    can_manage_staff = models.BooleanField(default=False)
    can_access_settings = models.BooleanField(default=False)
    can_manage_menu = models.BooleanField(default=False)
    can_manage_discounts = models.BooleanField(default=False)
    can_view_reports = models.BooleanField(default=False)

    class Meta:
        unique_together = ("organization", "name")
        ordering = ["name"]

    def __str__(self):
        return self.name


class StoreStaff(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="store_assignments"
    )
    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="staff"
    )
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="staff_assignments")
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ("user", "store")

    def __str__(self):
        return f"{self.user.email} @ {self.store.name} ({self.role.name})"
