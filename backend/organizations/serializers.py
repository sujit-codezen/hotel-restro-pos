from django.utils.text import slugify
from rest_framework import serializers

from organizations.models import Organization, Store


class StoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Store
        fields = [
            "id", "parent_store", "store_type", "name", "address", "phone", "is_active",
        ]
        read_only_fields = ["id"]


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = [
            "id", "name", "slug", "business_type", "timezone", "currency",
            "is_active", "onboarding_completed_at",
        ]
        read_only_fields = ["id", "slug", "onboarding_completed_at"]


class OnboardingSerializer(serializers.Serializer):
    """Drives the 'pick your business type' onboarding step: creates the
    Organization plus the right Store(s) per plan section 1 — a
    HOTEL_RESTAURANT org gets a HOTEL_PROPERTY store and a RESTAURANT store
    with parent_store set to it."""

    name = serializers.CharField(max_length=255)
    business_type = serializers.ChoiceField(choices=Organization.BusinessType.choices)

    def create(self, validated_data):
        from django.db import transaction

        from core.permissions import set_tenant_context

        with transaction.atomic():
            org = Organization.objects.create(
                name=validated_data["name"],
                slug=self._unique_slug(validated_data["name"]),
                business_type=validated_data["business_type"],
            )
            # The requesting user has no organization yet at this point, so
            # nothing has set the RLS session context (see
            # core.permissions.IsOrgMember) — without this, the Store
            # insert below would fail the tenant_isolation policy's
            # WITH CHECK under a restricted DB role.
            set_tenant_context(org.id)
            self._create_stores(org)
        return org

    @staticmethod
    def _unique_slug(name):
        base = slugify(name)[:40] or "org"
        slug = base
        suffix = 1
        while Organization.objects.filter(slug=slug).exists():
            suffix += 1
            slug = f"{base}-{suffix}"
        return slug

    def _create_stores(self, org):
        business_type = org.business_type
        if business_type == Organization.BusinessType.RESTAURANT:
            Store.objects.create(
                organization=org, store_type=Store.StoreType.RESTAURANT, name=org.name
            )
        elif business_type == Organization.BusinessType.HOTEL:
            Store.objects.create(
                organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name=org.name
            )
        else:  # HOTEL_RESTAURANT
            hotel_store = Store.objects.create(
                organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name=org.name
            )
            Store.objects.create(
                organization=org,
                store_type=Store.StoreType.RESTAURANT,
                name=f"{org.name} Restaurant",
                parent_store=hotel_store,
            )
