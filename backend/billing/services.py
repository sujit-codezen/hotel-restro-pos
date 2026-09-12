from django.db import transaction
from django.utils import timezone


def next_display_number(store):
    """Best-effort sequential per-store invoice number, e.g. INV-2026-000123.

    Uses select_for_update on an InvoiceCounter row so two simultaneous
    finalize() calls at the same store don't race onto the same number.
    Not a strict no-gap legal sequence: a finalize() that fails after
    incrementing the counter but before saving leaves a gap. Acceptable per
    the plan's Phase 1 decision; revisit if a stricter regime is required.
    """
    from billing.models import InvoiceCounter

    year = timezone.now().year
    with transaction.atomic():
        counter, _ = InvoiceCounter.objects.select_for_update().get_or_create(
            store=store, year=year, defaults={"organization": store.organization}
        )
        counter.last_value += 1
        counter.save(update_fields=["last_value"])
        return f"INV-{year}-{counter.last_value:06d}"
