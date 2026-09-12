from django.contrib import admin

from billing.models import Discount, Invoice, InvoiceCounter, InvoiceLine, Payment

admin.site.register(Invoice)
admin.site.register(InvoiceLine)
admin.site.register(Payment)
admin.site.register(Discount)
admin.site.register(InvoiceCounter)
