"""Attaching/detaching a ModifierGroup to a specific MenuItem — this is
the actual "how do I put Toppings/Size on this dish" step. Creating a
group (POST /modifier-groups/) only builds it in the reusable library;
nothing previously let it be linked to an item at all (MenuItemModifierGroup
had no ViewSet/URL, only a management-command seeding path), so a group
built in the UI could never actually show up on an item's ordering screen.
"""

from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import Role, StoreStaff, User
from catalog.models import MenuItem, MenuItemModifierGroup, ModifierGroup
from organizations.models import Organization, Store


def make_org_store():
    org = Organization.objects.create(
        name="Item Groups Org", slug="item-groups-org", business_type=Organization.BusinessType.RESTAURANT
    )
    store = Store.objects.create(organization=org, store_type=Store.StoreType.RESTAURANT, name="Main")
    return org, store


def make_staff_user(org, store, email, **role_flags):
    user = User.objects.create_user(email=email, password="testpass123", organization=org)
    role = Role.objects.create(organization=org, name=f"Role for {email}", **role_flags)
    StoreStaff.objects.create(user=user, store=store, role=role)
    return user


class MenuItemModifierGroupTests(APITestCase):
    def setUp(self):
        self.org, self.store = make_org_store()
        self.manager = make_staff_user(self.org, self.store, "manager@itemgroups.test", can_manage_menu=True)
        self.cashier = make_staff_user(self.org, self.store, "cashier@itemgroups.test")

        self.item = MenuItem.objects.create(
            organization=self.org, store=self.store, name="Margherita Pizza", price=Decimal("650")
        )
        self.size_group = ModifierGroup.objects.create(
            organization=self.org, store=self.store, name="Size", selection_type="SINGLE"
        )
        self.toppings_group = ModifierGroup.objects.create(
            organization=self.org, store=self.store, name="Toppings", selection_type="MULTIPLE"
        )

    def test_can_attach_a_modifier_group_to_an_item(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/menu-items/{self.item.id}/modifier-groups/", {"modifier_group": str(self.size_group.id)}
        )
        self.assertEqual(response.status_code, 201)
        group_names = [g["name"] for g in response.data["modifier_groups"]]
        self.assertEqual(group_names, ["Size"])
        self.assertTrue(
            MenuItemModifierGroup.objects.filter(menu_item=self.item, modifier_group=self.size_group).exists()
        )

    def test_attaching_a_second_group_appends_with_increasing_sort_order(self):
        self.client.force_authenticate(self.manager)
        self.client.post(f"/api/menu-items/{self.item.id}/modifier-groups/", {"modifier_group": str(self.size_group.id)})
        self.client.post(
            f"/api/menu-items/{self.item.id}/modifier-groups/", {"modifier_group": str(self.toppings_group.id)}
        )
        links = list(
            MenuItemModifierGroup.objects.filter(menu_item=self.item).order_by("sort_order")
        )
        self.assertEqual([link.modifier_group_id for link in links], [self.size_group.id, self.toppings_group.id])
        self.assertLess(links[0].sort_order, links[1].sort_order)

    def test_cannot_attach_the_same_group_twice(self):
        self.client.force_authenticate(self.manager)
        self.client.post(f"/api/menu-items/{self.item.id}/modifier-groups/", {"modifier_group": str(self.size_group.id)})
        response = self.client.post(
            f"/api/menu-items/{self.item.id}/modifier-groups/", {"modifier_group": str(self.size_group.id)}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(MenuItemModifierGroup.objects.filter(menu_item=self.item).count(), 1)

    def test_can_detach_a_modifier_group_from_an_item(self):
        self.client.force_authenticate(self.manager)
        self.client.post(f"/api/menu-items/{self.item.id}/modifier-groups/", {"modifier_group": str(self.size_group.id)})
        response = self.client.delete(f"/api/menu-items/{self.item.id}/modifier-groups/{self.size_group.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["modifier_groups"], [])
        self.assertFalse(MenuItemModifierGroup.objects.filter(menu_item=self.item).exists())

    def test_cashier_without_permission_cannot_attach_a_group(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            f"/api/menu-items/{self.item.id}/modifier-groups/", {"modifier_group": str(self.size_group.id)}
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(MenuItemModifierGroup.objects.filter(menu_item=self.item).exists())

    def test_cashier_without_permission_cannot_detach_a_group(self):
        self.client.force_authenticate(self.manager)
        self.client.post(f"/api/menu-items/{self.item.id}/modifier-groups/", {"modifier_group": str(self.size_group.id)})

        self.client.force_authenticate(self.cashier)
        response = self.client.delete(f"/api/menu-items/{self.item.id}/modifier-groups/{self.size_group.id}/")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(
            MenuItemModifierGroup.objects.filter(menu_item=self.item, modifier_group=self.size_group).exists()
        )
