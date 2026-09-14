from rest_framework import serializers

from accounts.models import Role, StoreStaff, User
from organizations.models import Store

PERMISSION_FLAGS = [
    "can_refund_or_void",
    "can_manage_staff",
    "can_access_settings",
    "can_manage_menu",
    "can_manage_discounts",
    "can_view_reports",
]


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "password"]
        read_only_fields = ["id"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "name", "is_system", *PERMISSION_FLAGS]
        read_only_fields = ["id", "is_system"]


class UserMeSerializer(serializers.ModelSerializer):
    organization_id = serializers.UUIDField(source="organization.id", read_only=True)
    store_roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "organization_id", "store_roles"]

    def get_store_roles(self, obj):
        return [
            {
                "store_id": str(a.store_id),
                "role": a.role.name,
                "permissions": {flag: getattr(a.role, flag) for flag in PERMISSION_FLAGS},
            }
            for a in obj.store_assignments.filter(is_active=True).select_related("role")
        ]


class InviteStaffSerializer(serializers.Serializer):
    """Creates a brand-new user already attached to the inviting org, then
    assigns them to a store/role in one call — unlike /auth/register/
    (self-serve signup, deliberately org-less until onboarding), this is
    the authenticated, can_manage_staff-gated path an existing org uses to
    bring a new person onto their team."""

    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    password = serializers.CharField(write_only=True, min_length=8)
    store = serializers.PrimaryKeyRelatedField(queryset=Store.objects.all())
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.all())

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value


class StoreStaffSerializer(serializers.ModelSerializer):
    role_name = serializers.CharField(source="role.name", read_only=True, default=None)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = StoreStaff
        fields = [
            "id", "user", "user_email", "user_name", "store", "role", "role_name",
            "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def get_user_name(self, obj):
        full_name = f"{obj.user.first_name} {obj.user.last_name}".strip()
        return full_name or None
