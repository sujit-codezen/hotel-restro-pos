"""Editing a reservation's room/room type/dates is only allowed while it's
still BOOKED — once CHECKED_IN (or later), the real occupancy lives on
the GuestStay/Room, not the Reservation, so changing these fields here
wouldn't move anything real and would just desync the two records."""

from datetime import date, timedelta
from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from customers.models import Customer
from hotel.models import Reservation, Room, RoomType
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Edit Lock Org", slug="edit-lock-org", business_type=Organization.BusinessType.HOTEL
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name="Main")
    return org, store


class ReservationEditLockTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="owner@editlock.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.room_type = RoomType.objects.create(
            organization=self.org, store=self.store, name="Deluxe", base_rate=Decimal("2000")
        )
        self.room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="101"
        )
        self.other_room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="102"
        )
        self.guest = Customer.objects.create(organization=self.org, phone="9800000001", name="Guest")
        self.reservation = Reservation.objects.create(
            organization=self.org, store=self.store, guest=self.guest, room_type=self.room_type,
            room=self.room, check_in_date=date.today(), check_out_date=date.today() + timedelta(days=2),
            rate_per_night=Decimal("2000"),
        )

    def test_can_change_room_while_booked(self):
        response = self.client.patch(
            f"/api/reservations/{self.reservation.id}/", {"room": str(self.other_room.id)}
        )
        self.assertEqual(response.status_code, 200)
        self.reservation.refresh_from_db()
        self.assertEqual(self.reservation.room_id, self.other_room.id)

    def test_can_change_dates_while_booked(self):
        response = self.client.patch(
            f"/api/reservations/{self.reservation.id}/",
            {"check_in_date": (date.today() + timedelta(days=1)).isoformat(),
             "check_out_date": (date.today() + timedelta(days=3)).isoformat()},
        )
        self.assertEqual(response.status_code, 200)

    def test_can_still_change_adults_after_check_in(self):
        self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        response = self.client.patch(f"/api/reservations/{self.reservation.id}/", {"adults": 3})
        self.assertEqual(response.status_code, 200)

    def test_cannot_change_room_after_check_in(self):
        self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        response = self.client.patch(
            f"/api/reservations/{self.reservation.id}/", {"room": str(self.other_room.id)}
        )
        self.assertEqual(response.status_code, 400)
        self.reservation.refresh_from_db()
        self.assertEqual(self.reservation.room_id, self.room.id)

    def test_cannot_change_dates_after_check_in(self):
        self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        response = self.client.patch(
            f"/api/reservations/{self.reservation.id}/",
            {"check_out_date": (date.today() + timedelta(days=5)).isoformat()},
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_change_room_type_after_check_in(self):
        other_type = RoomType.objects.create(
            organization=self.org, store=self.store, name="Suite", base_rate=Decimal("5000")
        )
        self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        response = self.client.patch(
            f"/api/reservations/{self.reservation.id}/", {"room_type": str(other_type.id)}
        )
        self.assertEqual(response.status_code, 400)
