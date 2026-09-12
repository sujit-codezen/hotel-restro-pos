from django.db import models
from django.utils.text import slugify

from core.models import BaseTenantModel


class Table(BaseTenantModel):
    class Status(models.TextChoices):
        AVAILABLE = "AVAILABLE", "Available"
        OCCUPIED = "OCCUPIED", "Occupied"
        BILLING = "BILLING", "Billing"
        RESERVED = "RESERVED", "Reserved"

    store = models.ForeignKey(
        "organizations.Store", on_delete=models.CASCADE, related_name="tables"
    )
    name = models.CharField(max_length=40)
    slug = models.SlugField(max_length=60, blank=True)
    capacity = models.PositiveIntegerField(default=2)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.AVAILABLE
    )
    pos_x = models.FloatField(default=0)
    pos_y = models.FloatField(default=0)
    shape = models.CharField(max_length=20, default="square")

    class Meta:
        ordering = ["name"]
        unique_together = [("store", "name"), ("store", "slug")]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = self._unique_slug()
        super().save(*args, **kwargs)

    def _unique_slug(self):
        """Derives a per-store-unique slug from `name` — set once at
        creation, not regenerated on rename (same as
        OnboardingSerializer._unique_slug for Organization)."""
        base = slugify(self.name)[:50] or "table"
        slug = base
        suffix = 1
        qs = Table.objects.filter(store_id=self.store_id)
        while qs.filter(slug=slug).exclude(pk=self.pk).exists():
            suffix += 1
            slug = f"{base}-{suffix}"
        return slug
