"""Reservation list display fields (guest_name/guest_phone/room_type_name/
room_number) and the cancel action's BOOKED-only guard."""

from datetime import date, timedelta
from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from customers.models import Customer
from hotel.models import Reservation, Room, RoomType
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Reservation Org", slug="reservation-org", business_type=Organization.BusinessType.HOTEL
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name="Main")
    return org, store


class ReservationTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="owner@reservationtest.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.room_type = RoomType.objects.create(
            organization=self.org, store=self.store, name="Deluxe", base_rate=Decimal("2000")
        )
        self.room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="101"
        )
        self.guest = Customer.objects.create(organization=self.org, phone="9800000001", name="Hari Gurung")
        self.reservation = Reservation.objects.create(
            organization=self.org,
            store=self.store,
            guest=self.guest,
            room_type=self.room_type,
            room=self.room,
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
            rate_per_night=Decimal("2000"),
        )

    def test_list_includes_guest_and_room_display_fields(self):
        response = self.client.get(f"/api/reservations/{self.reservation.id}/")
        self.assertEqual(response.data["guest_name"], "Hari Gurung")
        self.assertEqual(response.data["guest_phone"], "9800000001")
        self.assertEqual(response.data["room_type_name"], "Deluxe")
        self.assertEqual(response.data["room_number"], "101")

    def test_room_number_is_null_when_no_room_assigned(self):
        self.reservation.room = None
        self.reservation.save(update_fields=["room"])
        response = self.client.get(f"/api/reservations/{self.reservation.id}/")
        self.assertIsNone(response.data["room_number"])

    def test_can_cancel_a_booked_reservation(self):
        response = self.client.post(f"/api/reservations/{self.reservation.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.reservation.refresh_from_db()
        self.assertEqual(self.reservation.status, Reservation.Status.CANCELLED)

    def test_cannot_cancel_a_checked_in_reservation(self):
        self.reservation.status = Reservation.Status.CHECKED_IN
        self.reservation.save(update_fields=["status"])
        response = self.client.post(f"/api/reservations/{self.reservation.id}/cancel/")
        self.assertEqual(response.status_code, 400)
        self.reservation.refresh_from_db()
        self.assertEqual(self.reservation.status, Reservation.Status.CHECKED_IN)

    def test_guest_stay_id_is_null_before_check_in(self):
        response = self.client.get(f"/api/reservations/{self.reservation.id}/")
        self.assertIsNone(response.data["guest_stay_id"])

    def test_guest_stay_id_is_set_after_check_in(self):
        check_in = self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        response = self.client.get(f"/api/reservations/{self.reservation.id}/")
        self.assertEqual(response.data["guest_stay_id"], check_in.data["id"])

    def test_guest_stay_includes_guest_and_room_display_fields(self):
        check_in = self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        self.assertEqual(check_in.data["guest_name"], "Hari Gurung")
        self.assertEqual(check_in.data["guest_phone"], "9800000001")
        self.assertEqual(check_in.data["room_number"], "101")

    def test_checking_out_moves_the_reservation_to_checked_out(self):
        check_in = self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        self.client.post(f"/api/guest-stays/{check_in.data['id']}/check-out/")
        self.reservation.refresh_from_db()
        self.assertEqual(self.reservation.status, Reservation.Status.CHECKED_OUT)

    def test_guest_stay_id_still_points_to_the_folio_after_check_out(self):
        # A checked-out reservation has no IN_HOUSE stay anymore, but the
        # frontend still needs somewhere to link a "View bill" button to —
        # this used to go back to null the moment the guest checked out.
        check_in = self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        self.client.post(f"/api/guest-stays/{check_in.data['id']}/check-out/")
        response = self.client.get(f"/api/reservations/{self.reservation.id}/")
        self.assertEqual(response.data["guest_stay_id"], check_in.data["id"])
