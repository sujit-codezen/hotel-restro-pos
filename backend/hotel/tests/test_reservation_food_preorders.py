"""Pre-ordering food against a still-BOOKED reservation — there's no
Folio at that point (one only exists from check-in onward), so a
pre-order lives on the reservation itself until check_in copies it onto
the new folio as a real RESTAURANT_CHARGE line."""

from datetime import date, timedelta
from decimal import Decimal

from rest_framework.test import APITestCase

from catalog.models import MenuItem
from customers.models import Customer
from accounts.models import User
from hotel.models import Reservation, ReservationFoodItem, Room, RoomType
from organizations.models import Organization, Store


def make_org_store_with_restaurant():
    org = Organization.objects.create(
        name="Preorder Org", slug="preorder-org", business_type=Organization.BusinessType.HOTEL_RESTAURANT
    )
    hotel_store = Store.objects.create(organization=org, store_type=Store.StoreType.HOTEL_PROPERTY, name="Hotel")
    restaurant_store = Store.objects.create(
        organization=org, store_type=Store.StoreType.RESTAURANT, name="Restaurant", parent_store=hotel_store
    )
    return org, hotel_store, restaurant_store


class ReservationFoodPreorderTests(APITestCase):
    def setUp(self):
        self.org, self.store, self.restaurant_store = make_org_store_with_restaurant()
        self.user = User.objects.create_user(
            email="owner@preorder.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.room_type = RoomType.objects.create(
            organization=self.org, store=self.store, name="Deluxe", base_rate=Decimal("2000")
        )
        self.room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="101"
        )
        self.guest = Customer.objects.create(organization=self.org, phone="9800000001", name="Guest")
        self.reservation = Reservation.objects.create(
            organization=self.org, store=self.store, guest=self.guest, room_type=self.room_type,
            room=self.room, check_in_date=date.today(), check_out_date=date.today() + timedelta(days=2),
            rate_per_night=Decimal("2000"),
        )
        self.momo = MenuItem.objects.create(
            organization=self.org, store=self.restaurant_store, name="Chicken Momo", price=Decimal("350")
        )

    def test_can_pre_order_food_on_a_booked_reservation(self):
        response = self.client.post(
            f"/api/reservations/{self.reservation.id}/food-items/", {"menu_item": str(self.momo.id), "quantity": 2}
        )
        self.assertEqual(response.status_code, 201)
        item = response.data["food_items"][0]
        self.assertEqual(item["menu_item_name"], "Chicken Momo")
        self.assertEqual(item["quantity"], "2.00")
        self.assertEqual(item["unit_price"], "350.00")

    def test_can_remove_a_pre_ordered_item(self):
        add = self.client.post(
            f"/api/reservations/{self.reservation.id}/food-items/", {"menu_item": str(self.momo.id), "quantity": 1}
        )
        item_id = add.data["food_items"][0]["id"]
        response = self.client.delete(f"/api/reservations/{self.reservation.id}/food-items/{item_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["food_items"], [])

    def test_cannot_pre_order_once_checked_in(self):
        self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        response = self.client.post(
            f"/api/reservations/{self.reservation.id}/food-items/", {"menu_item": str(self.momo.id), "quantity": 1}
        )
        self.assertEqual(response.status_code, 400)

    def test_check_in_copies_pre_orders_onto_the_new_folio(self):
        self.client.post(
            f"/api/reservations/{self.reservation.id}/food-items/", {"menu_item": str(self.momo.id), "quantity": 2}
        )
        check_in = self.client.post(f"/api/reservations/{self.reservation.id}/check-in/")
        response = self.client.get("/api/folios/", {"guest_stay": check_in.data["id"]})
        folio = response.data["results"][0]
        food_line = next(l for l in folio["lines"] if l["description"] == "Chicken Momo")
        self.assertEqual(food_line["quantity"], "2.00")
        self.assertEqual(food_line["amount"], "700.00")
        self.assertEqual(folio["total"], 4700.0)  # 2 nights x 2000 + 700 food

    def test_pre_order_reprice_does_not_affect_the_menu_items_own_price(self):
        self.client.post(
            f"/api/reservations/{self.reservation.id}/food-items/", {"menu_item": str(self.momo.id), "quantity": 1}
        )
        self.momo.price = Decimal("500")
        self.momo.save(update_fields=["price"])
        item = ReservationFoodItem.objects.get(reservation=self.reservation)
        self.assertEqual(item.unit_price, Decimal("350.00"))

    def test_rejects_a_menu_item_from_an_unrelated_store(self):
        other_org = Organization.objects.create(
            name="Other Org", slug="other-preorder-org", business_type=Organization.BusinessType.RESTAURANT
        )
        other_store = Store.objects.create(organization=other_org, store_type=Store.StoreType.RESTAURANT, name="Other")
        other_item = MenuItem.objects.create(
            organization=other_org, store=other_store, name="Pizza", price=Decimal("800")
        )
        response = self.client.post(
            f"/api/reservations/{self.reservation.id}/food-items/", {"menu_item": str(other_item.id), "quantity": 1}
        )
        self.assertEqual(response.status_code, 404)


class CombinedStoreFoodPreorderTests(APITestCase):
    """A business that runs a single RESTAURANT-typed store which also
    owns its own room/reservation data directly — no separate hotel-
    property store at all, unlike the usual split setup. Found live: a
    test account exactly like this had no way to pre-order food because
    the lookup required a *child* restaurant store to exist."""

    def setUp(self):
        self.org = Organization.objects.create(
            name="Combined Org", slug="combined-preorder-org", business_type=Organization.BusinessType.RESTAURANT
        )
        self.store = Store.objects.create(organization=self.org, store_type=Store.StoreType.RESTAURANT, name="Momo House")
        self.user = User.objects.create_user(
            email="owner@combinedpreorder.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)
        self.room_type = RoomType.objects.create(
            organization=self.org, store=self.store, name="Deluxe", base_rate=Decimal("2000")
        )
        self.room = Room.objects.create(
            organization=self.org, store=self.store, room_type=self.room_type, number="101"
        )
        self.guest = Customer.objects.create(organization=self.org, phone="9800000001", name="Guest")
        self.reservation = Reservation.objects.create(
            organization=self.org, store=self.store, guest=self.guest, room_type=self.room_type,
            room=self.room, check_in_date=date.today(), check_out_date=date.today() + timedelta(days=2),
            rate_per_night=Decimal("2000"),
        )
        self.momo = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Chicken Momo", price=Decimal("350")
        )

    def test_can_pre_order_food_when_the_room_and_restaurant_share_one_store(self):
        response = self.client.post(
            f"/api/reservations/{self.reservation.id}/food-items/", {"menu_item": str(self.momo.id), "quantity": 1}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["food_items"][0]["menu_item_name"], "Chicken Momo")
