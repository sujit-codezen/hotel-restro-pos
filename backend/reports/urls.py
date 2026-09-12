from django.urls import path

from reports.views import (
    BestSellingItemsView,
    DashboardSummaryView,
    PaymentMethodReportView,
    PropertyPerformanceReportView,
    SalesDailyReportView,
    StaffPerformanceReportView,
    TaxReportView,
)

urlpatterns = [
    path("dashboard/summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("reports/sales-daily/", SalesDailyReportView.as_view(), name="report-sales-daily"),
    path(
        "reports/best-selling-items/",
        BestSellingItemsView.as_view(),
        name="report-best-selling-items",
    ),
    path(
        "reports/payment-methods/",
        PaymentMethodReportView.as_view(),
        name="report-payment-methods",
    ),
    path("reports/tax/", TaxReportView.as_view(), name="report-tax"),
    path(
        "reports/staff-performance/",
        StaffPerformanceReportView.as_view(),
        name="report-staff-performance",
    ),
    path(
        "reports/by-property/",
        PropertyPerformanceReportView.as_view(),
        name="report-by-property",
    ),
]
