from rest_framework import serializers
from rest_framework.validators import UniqueTogetherValidator

from tables.models import Table


class TableSerializer(serializers.ModelSerializer):
    class Meta:
        model = Table
        fields = ["id", "store", "name", "slug", "capacity", "status", "pos_x", "pos_y", "shape"]
        read_only_fields = ["id", "slug"]
        validators = [
            # UniqueTogetherValidator only interpolates {field_names} (checked
            # against DRF 3.18's source — {field_values} isn't supported), so
            # the message can't quote the actual name back to the user here.
            UniqueTogetherValidator(
                queryset=Table.objects.all(),
                fields=["store", "name"],
                message="A table with this name already exists at this store.",
            )
        ]
