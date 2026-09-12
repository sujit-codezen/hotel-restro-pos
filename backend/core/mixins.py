from rest_framework.exceptions import PermissionDenied, ValidationError

from core.permissions import require_permission


class OrgScopedViewSetMixin:
    """Applied to every ViewSet that touches a BaseTenantModel.

    - get_queryset(): filters to request.org so one org can never read
      another org's rows, including by ID (e.g. GET /api/orders/<uuid>/).
    - perform_create(): forces organization=request.org, ignoring/rejecting
      any organization value the client tried to send in the payload, and
      rejects a `store` value that doesn't belong to request.org — without
      this check, organization=request.org would still get force-set onto
      a row whose `store` FK points at another org's store.

    This mixin is the actual tenant-isolation enforcement point; it must be
    applied to every ViewSet over a BaseTenantModel and is covered by the
    parametrized isolation test in core/tests/test_tenant_isolation.py.
    """

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.org:
            return queryset.none()
        return queryset.filter(organization=self.request.org)

    def _check_store_belongs_to_org(self, serializer):
        store = serializer.validated_data.get("store")
        if store is not None and store.organization_id != self.request.org.id:
            raise ValidationError({"store": "Store does not belong to your organization."})

    def perform_create(self, serializer):
        if not self.request.org:
            raise PermissionDenied("No organization resolved for this user.")
        self._check_store_belongs_to_org(serializer)
        serializer.save(organization=self.request.org)

    def perform_update(self, serializer):
        self._check_store_belongs_to_org(serializer)
        serializer.save()


class RequiresPermissionMixin:
    """Gates create/update/destroy behind a Role permission flag — set
    `required_permission = "can_manage_menu"` (etc.) on the ViewSet.
    Scoped to the object's `store` when it has one (or the payload's
    `store` on create), org-wide otherwise (e.g. TaxClass, which has no
    store field). List/retrieve stay open to any org member — only
    mutating actions are gated.

    Must be listed BEFORE OrgScopedViewSetMixin in the ViewSet's bases, so
    this mixin's perform_create/perform_update run first in the MRO and
    the permission check happens before OrgScopedViewSetMixin's super()
    call actually saves anything.
    """

    required_permission = None

    def _permission_store(self, serializer=None, instance=None):
        obj = instance or (serializer.instance if serializer else None)
        store = getattr(obj, "store", None) if obj else None
        if store is None and serializer is not None:
            store = serializer.validated_data.get("store")
        return store

    def perform_create(self, serializer):
        require_permission(
            self.request, self.required_permission, store=self._permission_store(serializer=serializer)
        )
        super().perform_create(serializer)

    def perform_update(self, serializer):
        require_permission(
            self.request,
            self.required_permission,
            store=self._permission_store(serializer=serializer, instance=serializer.instance),
        )
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        require_permission(
            self.request, self.required_permission, store=self._permission_store(instance=instance)
        )
        instance.delete()
