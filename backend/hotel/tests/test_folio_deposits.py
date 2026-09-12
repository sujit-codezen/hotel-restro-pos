"""Advance/deposit payments taken mid-stay (FolioDeposit) — recorded
before there's an Invoice to attach a real Payment to, then carried over
as real Payments on the settlement Invoice once the folio closes, so a
guest who paid a deposit isn't charged for it again at checkout."""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from customers.models import Customer
from hotel.models import Folio, GuestStay, Reservation, Room, RoomType
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Deposit Org", slug="deposit-org", business_type=Organization.BusinessType.HOTEL
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name="Main")
    return org, store


class FolioDepositTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="owner@deposittest.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.room_type = RoomType.objects.create(
            organization=self.org, store=self.store, name="Deluxe", base_rate=Decimal("2000")
        )
        self.room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="101"
        )
        self.guest = Customer.objects.create(organization=self.org, phone="9800000001", name="Hari Gurung")
        self.guest_stay = GuestStay.objects.create(
            organization=self.org, store=self.store, room=self.room, guest=self.guest
        )
        self.folio = Folio.objects.create(organization=self.org, store=self.store, guest_stay=self.guest_stay)

    def test_can_record_an_advance_payment(self):
        response = self.client.post(
            f"/api/folios/{self.folio.id}/deposits/", {"method": "CASH", "amount": "1000"}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.data["deposits"]), 1)
        self.assertEqual(response.data["total_deposits"], Decimal("1000.00"))

    def test_balance_due_reflects_deposits_against_charges(self):
        self.client.post(f"/api/folios/{self.folio.id}/lines/", {
            "line_type": "ROOM_CHARGE", "description": "Room 101 x 2 nights", "unit_price": "2000", "quantity": 2,
        })
        response = self.client.post(
            f"/api/folios/{self.folio.id}/deposits/", {"method": "ESEWA", "amount": "1500"}
        )
        self.assertEqual(response.data["total"], Decimal("4000.00"))
        self.assertEqual(response.data["balance_due"], Decimal("2500.00"))

    def test_cannot_record_a_deposit_on_a_closed_folio(self):
        self.folio.close()
        response = self.client.post(
            f"/api/folios/{self.folio.id}/deposits/", {"method": "CASH", "amount": "500"}
        )
        self.assertEqual(response.status_code, 400)

    def test_deposit_rejects_a_non_positive_amount(self):
        response = self.client.post(
            f"/api/folios/{self.folio.id}/deposits/", {"method": "CASH", "amount": "0"}
        )
        self.assertEqual(response.status_code, 400)

    def test_closing_the_folio_carries_deposits_over_as_real_payments(self):
        self.client.post(f"/api/folios/{self.folio.id}/lines/", {
            "line_type": "ROOM_CHARGE", "description": "Room 101 x 2 nights", "unit_price": "2000", "quantity": 2,
        })
        self.client.post(f"/api/folios/{self.folio.id}/deposits/", {"method": "CASH", "amount": "1500"})

        invoice = self.folio.close()
        self.assertEqual(invoice.grand_total, Decimal("4000"))
        payment = invoice.payments.get()
        self.assertEqual(payment.method, "CASH")
        self.assertEqual(payment.amount, Decimal("1500"))
        self.assertEqual(invoice.status, invoice.Status.PARTIALLY_PAID)

    def test_closing_with_no_deposits_does_not_fabricate_a_payment(self):
        # Matches Order.bill()'s convention: an invoice's status is only
        # ever derived from payments at finalize()/apply_payment() time,
        # never assumed at creation — so with nothing collected in advance
        # it stays DRAFT (not "UNPAID", which would need a status write
        # this code path has no reason to make).
        self.client.post(f"/api/folios/{self.folio.id}/lines/", {
            "line_type": "ROOM_CHARGE", "description": "Room 101 x 1 night", "unit_price": "2000", "quantity": 1,
        })
        invoice = self.folio.close()
        self.assertEqual(invoice.payments.count(), 0)
        self.assertEqual(invoice.status, invoice.Status.DRAFT)

    def test_full_deposit_leaves_invoice_fully_paid_at_close(self):
        self.client.post(f"/api/folios/{self.folio.id}/lines/", {
            "line_type": "ROOM_CHARGE", "description": "Room 101 x 1 night", "unit_price": "2000", "quantity": 1,
        })
        self.client.post(f"/api/folios/{self.folio.id}/deposits/", {"method": "CARD", "amount": "2000"})
        invoice = self.folio.close()
        self.assertEqual(invoice.status, invoice.Status.PAID)
