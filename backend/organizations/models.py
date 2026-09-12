import uuid

from django.db import models

from core.models import TimeStampedModel


class Organization(TimeStampedModel):
    class BusinessType(models.TextChoices):
        RESTAURANT = "RESTAURANT", "Restaurant"
        HOTEL = "HOTEL", "Hotel"
        HOTEL_RESTAURANT = "HOTEL_RESTAURANT", "Hotel + Restaurant"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    business_type = models.CharField(max_length=20, choices=BusinessType.choices)
    timezone = models.CharField(max_length=64, default="Asia/Kathmandu")
    currency = models.CharField(max_length=8, default="NPR")
    is_active = models.BooleanField(default=True)
    onboarding_completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.name


class Store(TimeStampedModel):
    class StoreType(models.TextChoices):
        RESTAURANT = "RESTAURANT", "Restaurant"
        HOTEL_PROPERTY = "HOTEL_PROPERTY", "Hotel Property"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="stores"
    )
    parent_store = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="child_stores",
    )
    store_type = models.CharField(max_length=20, choices=StoreType.choices)
    name = models.CharField(max_length=255)
    address = models.CharField(max_length=500, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        indexes = [models.Index(fields=["organization", "store_type"])]

    def __str__(self):
        return f"{self.name} ({self.get_store_type_display()})"
