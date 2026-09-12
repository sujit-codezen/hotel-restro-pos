from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.models import Invoice, InvoiceLine, Payment
from core.permissions import IsOrgMember, require_permission


class DashboardSummaryView(APIView):
    """Deliberately NOT gated by can_view_reports — this is the landing
    page every staff member sees, not one of the detailed reports under
    Admin · Reports."""

    permission_classes = [IsOrgMember]

    def get(self, request):
        today = timezone.localdate()
        invoices = Invoice.objects.filter(
            organization=request.org, finalized_at__date=today
        ).exclude(status=Invoice.Status.VOID)

        sales_total = invoices.aggregate(total=Sum("grand_total"))["total"] or 0
        orders_count = invoices.count()
        items_sold = (
            InvoiceLine.objects.filter(invoice__in=invoices).aggregate(
                total=Sum("quantity")
            )["total"]
            or 0
        )
        # Outstanding *balance*, net of refunds — not just grand_total minus
        # gross payments (annotate(Sum("payments__amount"),
        # Sum("payments__refunds__amount")) together would double-count via
        # join fan-out, so this uses Invoice._net_paid() per row instead,
        # same as InvoiceSerializer.get_balance_due()).
        unsettled = Invoice.objects.filter(
            organization=request.org,
            status__in=[Invoice.Status.UNPAID, Invoice.Status.PARTIALLY_PAID],
        ).prefetch_related("payments__refunds")
        pending_credit = sum(
            (inv.grand_total - inv._net_paid() for inv in unsettled), start=0
        )

        return Response(
            {
                "todays_sales": sales_total,
                "todays_orders": orders_count,
                "items_sold": items_sold,
                "pending_credit": pending_credit,
            }
        )


class SalesDailyReportView(APIView):
    permission_classes = [IsOrgMember]

    def get(self, request):
        require_permission(request, "can_view_reports")
        days = int(request.query_params.get("days", 30))
        since = timezone.localdate() - timedelta(days=days)
        rows = (
            Invoice.objects.filter(
                organization=request.org, finalized_at__date__gte=since
            )
            .exclude(status=Invoice.Status.VOID)
            .values("finalized_at__date")
            .annotate(total=Sum("grand_total"), count=Count("id"))
            .order_by("finalized_at__date")
        )
        return Response(list(rows))


class BestSellingItemsView(APIView):
    permission_classes = [IsOrgMember]

    def get(self, request):
        require_permission(request, "can_view_reports")
        rows = (
            InvoiceLine.objects.filter(
                invoice__organization=request.org,
                source_type=InvoiceLine.SourceType.MENU_ITEM,
            )
            .exclude(invoice__status=Invoice.Status.VOID)
            .values("description")
            .annotate(quantity_sold=Sum("quantity"))
            .order_by("-quantity_sold")[:20]
        )
        return Response(list(rows))


class PaymentMethodReportView(APIView):
    permission_classes = [IsOrgMember]

    def get(self, request):
        require_permission(request, "can_view_reports")
        # Net of refunds per payment, then grouped by method — a single
        # Sum("refunds__amount")-then-Sum queryset would double-count via
        # join fan-out, so this totals in Python instead (report-scale data,
        # same reasoning as pending_credit above).
        totals: dict[str, dict] = {}
        payments = Payment.objects.filter(organization=request.org).prefetch_related("refunds")
        for payment in payments:
            refunded = sum((r.amount for r in payment.refunds.all()), start=Decimal("0"))
            bucket = totals.setdefault(payment.method, {"method": payment.method, "total": Decimal("0"), "count": 0})
            bucket["total"] += payment.amount - refunded
            bucket["count"] += 1
        rows = sorted(totals.values(), key=lambda r: r["total"], reverse=True)
        return Response(rows)


class TaxReportView(APIView):
    """Tax actually collected per day, from InvoiceLine.tax_amount — see
    Order.bill()'s exclusive-tax computation. Invoices whose lines carry no
    TaxClass (or an inclusive one — a known, documented gap) simply
    contribute 0, which is the honest number, not a broken-down "by tax
    class" report InvoiceLine's schema can't actually support (no FK back
    to the TaxClass that produced it)."""

    permission_classes = [IsOrgMember]

    def get(self, request):
        require_permission(request, "can_view_reports")
        days = int(request.query_params.get("days", 30))
        since = timezone.localdate() - timedelta(days=days)
        invoices = Invoice.objects.filter(
            organization=request.org, finalized_at__date__gte=since
        ).exclude(status=Invoice.Status.VOID)
        rows = (
            InvoiceLine.objects.filter(invoice__in=invoices)
            .values("invoice__finalized_at__date")
            .annotate(tax_collected=Sum("tax_amount"))
            .order_by("invoice__finalized_at__date")
        )
        return Response(
            [
                {
                    "date": row["invoice__finalized_at__date"],
                    "tax_collected": row["tax_collected"] or 0,
                }
                for row in rows
            ]
        )


class PropertyPerformanceReportView(APIView):
    """Per-store breakdown across the organization's properties. Every
    report above already silently combines all of an org's stores via
    `organization=request.org` — fine for a single-property org, but an
    org running several stores (e.g. multiple restaurant branches, or a
    Hotel + its attached Restaurant) has no way to see which property
    actually produced those numbers. This is that view."""

    permission_classes = [IsOrgMember]

    def get(self, request):
        require_permission(request, "can_view_reports")
        days = int(request.query_params.get("days", 30))
        since = timezone.localdate() - timedelta(days=days)
        invoices = Invoice.objects.filter(
            organization=request.org, finalized_at__date__gte=since
        ).exclude(status=Invoice.Status.VOID)

        # Two separate queries, merged in Python by store id — annotating
        # Sum("grand_total") together with a Sum over a joined `lines`
        # table in one query would fan out grand_total across each line
        # row and inflate it, same reasoning as the other reports above.
        sales_rows = invoices.values("store_id", "store__name").annotate(
            total_sales=Sum("grand_total"), order_count=Count("id")
        )
        items_rows = (
            InvoiceLine.objects.filter(invoice__in=invoices)
            .values("invoice__store_id")
            .annotate(items_sold=Sum("quantity"))
        )
        items_by_store = {row["invoice__store_id"]: row["items_sold"] or 0 for row in items_rows}

        rows = [
            {
                "store_id": row["store_id"],
                "store_name": row["store__name"],
                "total_sales": row["total_sales"] or 0,
                "order_count": row["order_count"],
                "items_sold": items_by_store.get(row["store_id"], 0),
            }
            for row in sales_rows
        ]
        rows.sort(key=lambda r: r["total_sales"], reverse=True)
        return Response(rows)


class StaffPerformanceReportView(APIView):
    """Sales handled per staff member, from Payment.received_by — the
    person who actually took the payment, not who created the order (an
    order can be built by one cashier and paid out by another at a busy
    counter)."""

    permission_classes = [IsOrgMember]

    def get(self, request):
        require_permission(request, "can_view_reports")
        totals: dict[str, dict] = {}
        payments = (
            Payment.objects.filter(organization=request.org, received_by__isnull=False)
            .select_related("received_by__user")
            .prefetch_related("refunds")
        )
        for payment in payments:
            refunded = sum((r.amount for r in payment.refunds.all()), start=Decimal("0"))
            staff = payment.received_by
            bucket = totals.setdefault(
                str(staff.id),
                {
                    "staff_id": str(staff.id),
                    "staff_name": staff.user.first_name or staff.user.email,
                    "total_collected": Decimal("0"),
                    "payment_count": 0,
                },
            )
            bucket["total_collected"] += payment.amount - refunded
            bucket["payment_count"] += 1
        rows = sorted(totals.values(), key=lambda r: r["total_collected"], reverse=True)
        return Response(rows)
