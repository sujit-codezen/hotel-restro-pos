"""Date filtering on /api/kitchen-tickets/ — lets the KDS "Done" tab
browse a previous day instead of only ever showing everything that ever
shipped. created_at is auto_now_add, so tickets are backdated via a
queryset .update() after creation (the only way to get a specific
timestamp onto an auto_now_add field in a test).
"""

from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from catalog.models import MenuItem
from orders.models import KitchenTicket, KitchenTicketItem, Order, OrderItem
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="KDS Date Filter Org", slug="kds-date-filter-org",
        business_type=Organization.BusinessType.RESTAURANT,
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


def make_ticket(org, store, created_at):
    menu_item = MenuItem.objects.create(organization=org, store=store, name="Coke", price=Decimal("100"))
    order = Order.objects.create(organization=org, store=store, order_type=Order.OrderType.TAKEAWAY)
    item = OrderItem.objects.create(organization=org, order=order, menu_item=menu_item, unit_price=Decimal("100"))
    ticket = KitchenTicket.objects.create(
        organization=org, store=store, order=order, kitchen_station="Kitchen"
    )
    KitchenTicketItem.objects.create(organization=org, kitchen_ticket=ticket, order_item=item)
    KitchenTicket.objects.filter(pk=ticket.pk).update(created_at=created_at)
    return ticket


class KitchenTicketDateFilterTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.user = User.objects.create_user(
            email="cook@datefilter.test", password="testpass123", organization=self.org
        )
        self.client.force_authenticate(self.user)

        now = timezone.now()
        self.today_ticket = make_ticket(self.org, self.store, now)
        self.yesterday_ticket = make_ticket(self.org, self.store, now - timedelta(days=1))
        self.last_week_ticket = make_ticket(self.org, self.store, now - timedelta(days=7))

    def test_no_date_filter_returns_everything(self):
        response = self.client.get(f"/api/kitchen-tickets/?store={self.store.id}")
        self.assertEqual(response.data["count"], 3)

    def test_date_filter_returns_only_that_calendar_day(self):
        today = timezone.localdate().isoformat()
        response = self.client.get(f"/api/kitchen-tickets/?store={self.store.id}&date={today}")
        ids = {row["id"] for row in response.data["results"]}
        self.assertEqual(ids, {str(self.today_ticket.id)})

    def test_date_filter_on_a_previous_day(self):
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        response = self.client.get(f"/api/kitchen-tickets/?store={self.store.id}&date={yesterday}")
        ids = {row["id"] for row in response.data["results"]}
        self.assertEqual(ids, {str(self.yesterday_ticket.id)})

    def test_date_range_filter(self):
        start = (timezone.localdate() - timedelta(days=2)).isoformat()
        end = timezone.localdate().isoformat()
        response = self.client.get(
            f"/api/kitchen-tickets/?store={self.store.id}&date_from={start}&date_to={end}"
        )
        ids = {row["id"] for row in response.data["results"]}
        self.assertEqual(ids, {str(self.today_ticket.id), str(self.yesterday_ticket.id)})

    def test_results_are_newest_first(self):
        response = self.client.get(f"/api/kitchen-tickets/?store={self.store.id}")
        ids = [row["id"] for row in response.data["results"]]
        self.assertEqual(
            ids,
            [str(self.today_ticket.id), str(self.yesterday_ticket.id), str(self.last_week_ticket.id)],
        )
