from django.db import models

from core.models import BaseTenantModel


class Customer(BaseTenantModel):
    """One model shared by restaurant walk-in customers and hotel guests —
    referenced by Order.customer and Reservation/GuestStay.guest."""

    phone = models.CharField(max_length=32)
    name = models.CharField(max_length=160, blank=True)
    email = models.EmailField(blank=True)
    notes = models.TextField(blank=True)
    loyalty_points = models.PositiveIntegerField(default=0)
    credit_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        unique_together = ("organization", "phone")
        ordering = ["-created_at"]

    def __str__(self):
        return self.name or self.phone
