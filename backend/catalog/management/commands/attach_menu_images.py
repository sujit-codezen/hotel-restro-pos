"""Dev/demo helper: attaches a real photo (from Wikimedia Commons, public
domain / freely-licensed) to menu items seeded by seed_menu, for items
where a genuinely matching photo could be found — see IMAGE_MAP. Items
not in the map (no good match was available, or the closest match would
be misleading — e.g. a non-veg photo on a veg-labeled dish) keep the
existing gradient-monogram fallback rather than get a wrong photo.

Idempotent: skips items that already have an image unless --force.
manage.py attach_menu_images --store <uuid> [--force]
"""

import time
import urllib.error
import urllib.request

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError

from catalog.models import MenuItem
from organizations.models import Store

# item name -> Wikimedia Commons filename (resolved via Special:FilePath,
# which redirects to the current asset regardless of upload-hash path).
IMAGE_MAP = {
    "Chicken Pizza": "Eq_it-na_pizza-margherita_sep2005_sml.jpg",
    "Margherita Pizza": "Eq_it-na_pizza-margherita_sep2005_sml.jpg",
    "Veg Supreme Pizza": "Eq_it-na_pizza-margherita_sep2005_sml.jpg",
    "Farmhouse Pizza": "Eq_it-na_pizza-margherita_sep2005_sml.jpg",
    "Pepperoni Pizza": "Pepperoni_pizza.jpg",
    "BBQ Chicken Pizza": "Pepperoni_pizza.jpg",
    "Classic Beef Burger": "Cheeseburger.jpg",
    "Chicken Burger": "Cheeseburger.jpg",
    "Veg Burger": "Cheeseburger.jpg",
    "Cheese Burger": "Cheeseburger.jpg",
    "Spicy Chicken Burger": "Cheeseburger.jpg",
    "Chicken Momo": "Chicken_momo.jpg",
    "Veg Momo": "Momos.jpg",
    "Chicken Wings": "Chilli_chicken.jpg",
    "Spring Rolls": "Spring_rolls.jpg",
    "Chilli Chicken": "Chilli_chicken.jpg",
    "Chicken Biryani": "Chicken_fried_rice.jpg",
    "Butter Chicken": "Butter_chicken.jpg",
    "Dal Makhani": "Dal_Makhani.jpg",
    "Fried Rice": "Chicken_fried_rice.jpg",
    "Mango Lassi": "Mango_lassi.jpg",
    "Masala Tea": "Masala_chai.jpg",
    "Cold Coffee": "Iced_coffee.jpg",
    "Chocolate Brownie": "Chocolate_brownie.jpg",
    "Ice Cream Sundae": "Ice_cream_sundae.jpg",
    "Cheesecake": "Cheesecake.jpg",
}

USER_AGENT = "pos-restro-hotel-dev-seed/1.0 (local dev fixture data)"


class Command(BaseCommand):
    help = "Attaches real Wikimedia Commons photos to seeded menu items with a genuine match."

    def add_arguments(self, parser):
        parser.add_argument("--store", required=True, help="Store UUID.")
        parser.add_argument("--force", action="store_true", help="Replace existing images too.")

    def handle(self, *args, **options):
        try:
            store = Store.objects.get(id=options["store"])
        except Store.DoesNotExist as exc:
            raise CommandError(f"No store with id {options['store']}") from exc

        items = MenuItem.objects.filter(store=store, name__in=IMAGE_MAP)
        attached, skipped, failed = 0, 0, 0

        for item in items:
            if item.image and not options["force"]:
                skipped += 1
                continue
            filename = IMAGE_MAP[item.name]
            # width= asks Commons for a resized thumbnail rather than the
            # full-resolution original — plenty for a small menu tile, and
            # what Commons' own rate-limit error message asks anonymous
            # scripts to use instead of full images.
            url = f"https://commons.wikimedia.org/wiki/Special:FilePath/{filename}?width=400"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = resp.read()
            except urllib.error.URLError as exc:
                self.stderr.write(f"  failed {item.name} ({filename}): {exc}")
                failed += 1
                continue
            item.image.save(filename, ContentFile(data), save=True)
            self.stdout.write(f"  {item.name} <- {filename}")
            attached += 1
            time.sleep(2)  # Commons rate-limits anonymous requests.

        self.stdout.write(self.style.SUCCESS(
            f"Attached {attached} images, skipped {skipped} (already had one), {failed} failed."
        ))
