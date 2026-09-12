"""Room-service ordering embedded on the Folio page: an order created
with guest_stay pre-set (so /orders/?guest_stay=<id> can find and resume
it across page loads, before it's ever actually charged) and settled via
charge-to-room instead of the normal bill/pay flow."""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from catalog.models import MenuItem
from customers.models import Customer
from hotel.models import Folio, GuestStay, Room, RoomType
from orders.models import Order
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Room Service Org", slug="room-service-org", business_type=Organization.BusinessType.HOTEL_RESTAURANT
    )
    hotel_store = Store.objects.create(organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name="Hotel")
    restaurant_store = Store.objects.create(
        organization=org, store_type=Store.StoreType.RESTAURANT, name="Restaurant", parent_store=hotel_store
    )
    return org, hotel_store, restaurant_store


class RoomServiceChargeToRoomTests(APITestCase):
    def setUp(self):
        self.org, self.hotel_store, self.restaurant_store = make_org_store()
        self.user = User.objects.create_user(
            email="cashier@roomservice.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        room_type = RoomType.objects.create(
            organization=self.org, store=self.hotel_store, name="Deluxe", base_rate=Decimal("2000")
        )
        self.room = Room.objects.create(
            organization=self.org, store=self.hotel_store, room_type=room_type, number="101"
        )
        guest = Customer.objects.create(organization=self.org, phone="9800000001", name="Guest")
        self.guest_stay = GuestStay.objects.create(
            organization=self.org, store=self.hotel_store, room=self.room, guest=guest
        )
        self.folio = Folio.objects.create(organization=self.org, store=self.hotel_store, guest_stay=self.guest_stay)
        self.momo = MenuItem.objects.create(
            organization=self.org, store=self.restaurant_store, name="Chicken Momo", price=Decimal("350")
        )

    def test_order_can_be_created_with_guest_stay_preset(self):
        response = self.client.post("/api/orders/", {
            "store": str(self.restaurant_store.id), "order_type": "ROOM_SERVICE", "guest_stay": str(self.guest_stay.id),
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(str(response.data["guest_stay"]), str(self.guest_stay.id))

    def test_guest_stay_filter_finds_the_in_progress_order(self):
        created = self.client.post("/api/orders/", {
            "store": str(self.restaurant_store.id), "order_type": "ROOM_SERVICE", "guest_stay": str(self.guest_stay.id),
        }).data
        response = self.client.get("/api/orders/", {"guest_stay": str(self.guest_stay.id), "status": "OPEN"})
        ids = [str(o["id"]) for o in response.data["results"]]
        self.assertEqual(ids, [str(created["id"])])

    def test_charging_a_room_service_order_to_room_posts_folio_lines(self):
        order = self.client.post("/api/orders/", {
            "store": str(self.restaurant_store.id), "order_type": "ROOM_SERVICE", "guest_stay": str(self.guest_stay.id),
        }).data
        self.client.post(f"/api/orders/{order['id']}/items/", {"menu_item": str(self.momo.id), "quantity": 2})

        response = self.client.post(
            f"/api/orders/{order['id']}/charge-to-room/", {"guest_stay_id": str(self.guest_stay.id)}
        )
        self.assertEqual(response.status_code, 201)

        self.folio.refresh_from_db()
        line = self.folio.lines.get()
        self.assertEqual(line.description, "Chicken Momo")
        self.assertEqual(line.amount, Decimal("700.00"))

        order_obj = Order.objects.get(id=order["id"])
        self.assertEqual(order_obj.status, Order.Status.CHARGED_TO_ROOM)
