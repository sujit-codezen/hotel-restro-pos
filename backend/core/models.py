import uuid

from django.db import models


class TenantManager(models.Manager):
    """Default manager for tenant-owned models. Scoping to the current
    request's organization happens in OrgScopedViewSetMixin, not here —
    this manager exists so `Model.objects` never accidentally returns
    cross-tenant rows when used outside a request (e.g. in a shell)."""

    def for_org(self, organization):
        return self.get_queryset().filter(organization=organization)


class BaseTenantModel(models.Model):
    """Abstract base for every model that belongs to a single Organization.

    `organization` is stored directly (not only derivable via `store`) so
    every ViewSet can filter with one join-free `.filter(organization=...)`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = TenantManager()

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
