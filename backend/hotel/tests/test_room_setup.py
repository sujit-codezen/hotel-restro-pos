"""Room type / room setup from one page (the hotel equivalent of the
Tables add-popup work): unique name per store for RoomType, unique
number per store for Room (Room already had this at the DB level since
its very first migration — this only adds the friendly serializer
message), and the two delete guards each model's PROTECT foreign keys
need (Room.room_type, GuestStay.room) so removing something still in
use surfaces a clear 400 instead of a raw ProtectedError 500.
"""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from customers.models import Customer
from hotel.models import GuestStay, Room, RoomType
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Room Setup Org", slug="room-setup-org", business_type=Organization.BusinessType.HOTEL
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name="Main")
    return org, store


class RoomSetupTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="owner@roomsetup.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.room_type = RoomType.objects.create(
            organization=self.org, store=self.store, name="Deluxe", base_rate=Decimal("2000")
        )

    def test_api_rejects_duplicate_room_type_name_in_same_store(self):
        response = self.client.post(
            "/api/room-types/", {"store": str(self.store.id), "name": "Deluxe", "base_rate": "2500"}
        )
        self.assertEqual(response.status_code, 400)

    def test_api_rejects_duplicate_room_number_in_same_store(self):
        Room.objects.create(organization=self.org, store=self.store, room_type=self.room_type, number="101")
        response = self.client.post(
            "/api/rooms/",
            {"store": str(self.store.id), "room_type": str(self.room_type.id), "number": "101"},
        )
        self.assertEqual(response.status_code, 400)

    def test_room_response_includes_room_type_name(self):
        room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="102"
        )
        response = self.client.get(f"/api/rooms/{room.id}/")
        self.assertEqual(response.data["room_type_name"], "Deluxe")

    def test_can_delete_an_unused_room_type(self):
        response = self.client.delete(f"/api/room-types/{self.room_type.id}/")
        self.assertEqual(response.status_code, 204)

    def test_cannot_delete_a_room_type_with_rooms(self):
        Room.objects.create(organization=self.org, store=self.store, room_type=self.room_type, number="103")
        response = self.client.delete(f"/api/room-types/{self.room_type.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(RoomType.objects.filter(id=self.room_type.id).exists())

    def test_can_delete_an_available_room(self):
        room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="104"
        )
        response = self.client.delete(f"/api/rooms/{room.id}/")
        self.assertEqual(response.status_code, 204)

    def test_cannot_delete_an_occupied_room(self):
        room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="105",
            status=Room.Status.OCCUPIED,
        )
        response = self.client.delete(f"/api/rooms/{room.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Room.objects.filter(id=room.id).exists())

    def test_cannot_delete_a_room_with_guest_stay_history(self):
        room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="106"
        )
        customer = Customer.objects.create(organization=self.org, phone="9800000000", name="Guest")
        GuestStay.objects.create(organization=self.org, store=self.store, room=room, guest=customer)

        response = self.client.delete(f"/api/rooms/{room.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Room.objects.filter(id=room.id).exists())
