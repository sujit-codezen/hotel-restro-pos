"""Room double-booking guard: the same room can't be assigned to two
guests with overlapping dates, whether that happens at reservation
creation, on an update, or at check-in time (which can reassign a
different room than the one originally booked)."""

from datetime import date, timedelta
from decimal import Decimal

from rest_framework.test import APITestCase

from customers.models import Customer
from accounts.models import User
from hotel.models import Reservation, Room, RoomType
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Double Booking Org", slug="double-booking-org", business_type=Organization.BusinessType.HOTEL
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name="Main")
    return org, store


class RoomDoubleBookingTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="owner@doublebooking.test", password="testpass123", organization=self.org
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
        self.guest_a = Customer.objects.create(organization=self.org, phone="9800000001", name="Guest A")
        self.guest_b = Customer.objects.create(organization=self.org, phone="9800000002", name="Guest B")
        self.today = date.today()

    def _reservation_payload(self, guest, room, check_in, check_out):
        return {
            "store": str(self.store.id),
            "guest": str(guest.id),
            "room_type": str(self.room_type.id),
            "room": str(room.id),
            "check_in_date": check_in.isoformat(),
            "check_out_date": check_out.isoformat(),
            "rate_per_night": "2000",
        }

    def test_cannot_create_an_overlapping_reservation_for_the_same_room(self):
        self.client.post(
            "/api/reservations/",
            self._reservation_payload(self.guest_a, self.room, self.today, self.today + timedelta(days=3)),
        )
        response = self.client.post(
            "/api/reservations/",
            self._reservation_payload(
                self.guest_b, self.room, self.today + timedelta(days=1), self.today + timedelta(days=2)
            ),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Reservation.objects.filter(room=self.room).count(), 1)

    def test_back_to_back_dates_do_not_conflict(self):
        self.client.post(
            "/api/reservations/",
            self._reservation_payload(self.guest_a, self.room, self.today, self.today + timedelta(days=2)),
        )
        # Guest B checks in exactly when guest A checks out — not an overlap.
        response = self.client.post(
            "/api/reservations/",
            self._reservation_payload(
                self.guest_b, self.room, self.today + timedelta(days=2), self.today + timedelta(days=4)
            ),
        )
        self.assertEqual(response.status_code, 201)

    def test_a_different_room_for_overlapping_dates_is_fine(self):
        self.client.post(
            "/api/reservations/",
            self._reservation_payload(self.guest_a, self.room, self.today, self.today + timedelta(days=3)),
        )
        response = self.client.post(
            "/api/reservations/",
            self._reservation_payload(
                self.guest_b, self.other_room, self.today, self.today + timedelta(days=3)
            ),
        )
        self.assertEqual(response.status_code, 201)

    def test_cancelled_reservation_frees_up_the_room(self):
        first = self.client.post(
            "/api/reservations/",
            self._reservation_payload(self.guest_a, self.room, self.today, self.today + timedelta(days=3)),
        ).data
        self.client.post(f"/api/reservations/{first['id']}/cancel/")

        response = self.client.post(
            "/api/reservations/",
            self._reservation_payload(self.guest_b, self.room, self.today, self.today + timedelta(days=3)),
        )
        self.assertEqual(response.status_code, 201)

    def test_updating_an_unrelated_field_does_not_falsely_conflict_with_itself(self):
        first = self.client.post(
            "/api/reservations/",
            self._reservation_payload(self.guest_a, self.room, self.today, self.today + timedelta(days=3)),
        ).data
        response = self.client.patch(f"/api/reservations/{first['id']}/", {"adults": 2})
        self.assertEqual(response.status_code, 200)

    def test_rejects_checkout_on_or_before_checkin(self):
        response = self.client.post(
            "/api/reservations/",
            self._reservation_payload(self.guest_a, self.room, self.today, self.today),
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_check_in_with_a_room_double_booked_for_the_dates(self):
        # Guest A is BOOKED into room 101 for today→+3.
        reservation_a = self.client.post(
            "/api/reservations/",
            self._reservation_payload(self.guest_a, self.room, self.today, self.today + timedelta(days=3)),
        ).data
        # Guest B is BOOKED into room 102 for an overlapping range, then
        # tries to check in against room 101 instead (e.g. a walk-in swap).
        reservation_b = self.client.post(
            "/api/reservations/",
            self._reservation_payload(
                self.guest_b, self.other_room, self.today, self.today + timedelta(days=3)
            ),
        ).data
        self.client.post(f"/api/reservations/{reservation_a['id']}/check-in/")

        response = self.client.post(
            f"/api/reservations/{reservation_b['id']}/check-in/", {"room": str(self.room.id)}
        )
        self.assertEqual(response.status_code, 400)
