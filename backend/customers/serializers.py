from rest_framework import serializers

from customers.models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = [
            "id", "phone", "name", "email", "notes", "loyalty_points",
            "credit_balance", "created_at",
        ]
        read_only_fields = ["id", "created_at"]
