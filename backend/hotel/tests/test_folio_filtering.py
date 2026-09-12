"""GET /folios/?guest_stay=<id> must actually filter — found live while
testing the deposit feature: FolioViewSet had no filterset_fields at all,
so the query param was silently ignored and every folio in the org came
back. The frontend folio page takes results[0], so a guest's brand-new
open folio could show another guest's old, already-closed one instead."""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from customers.models import Customer
from hotel.models import Folio, GuestStay, Room, RoomType
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Folio Filter Org", slug="folio-filter-org", business_type=Organization.BusinessType.HOTEL
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name="Main")
    return org, store


class FolioFilteringTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="owner@foliofilter.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.room_type = RoomType.objects.create(
            organization=self.org, store=self.store, name="Deluxe", base_rate=Decimal("2000")
        )
        self.room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="101"
        )

        guest_a = Customer.objects.create(organization=self.org, phone="9800000001", name="Guest A")
        stay_a = GuestStay.objects.create(organization=self.org, store=self.store, room=self.room, guest=guest_a)
        self.folio_a = Folio.objects.create(organization=self.org, store=self.store, guest_stay=stay_a)

        guest_b = Customer.objects.create(organization=self.org, phone="9800000002", name="Guest B")
        self.stay_b = GuestStay.objects.create(organization=self.org, store=self.store, room=self.room, guest=guest_b)
        self.folio_b = Folio.objects.create(organization=self.org, store=self.store, guest_stay=self.stay_b)

    def test_guest_stay_filter_returns_only_the_matching_folio(self):
        response = self.client.get("/api/folios/", {"guest_stay": str(self.stay_b.id)})
        ids = [f["id"] for f in response.data["results"]]
        self.assertEqual(ids, [str(self.folio_b.id)])
